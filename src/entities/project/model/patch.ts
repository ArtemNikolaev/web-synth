import { makeModule, ports, type Module, type Point } from '../../audio-module/@x/project.ts'

export type WindowState = Point & { width: number; height: number; minimized: boolean }

export type Wire = { id: string; source: string; sourceHandle: string; target: string; targetHandle: string }
export type Patch = {
  modules: Module[]
  wires: Wire[]
  viewport: Point & { zoom: number }
  windows: Record<string, WindowState>
}
export type Version = { id: string; name: string; date: string; patch: Patch }
export type Project = { schemaVersion: 1; id: string; name: string; patch: Patch; versions: Version[] }

export const uid = () => crypto.randomUUID()
export const emptyPatch = (): Patch => ({ modules: [], wires: [], viewport: { x: 0, y: 0, zoom: 1 }, windows: {} })
export const createProject = (name: string): Project => ({ schemaVersion: 1, id: uid(), name, patch: emptyPatch(), versions: [] })
export function signalAt(module: Module | undefined, side: 'in' | 'out', handle: string) {
  return module && ports(module, side).find(port => port.id === handle)?.signal
}

export function canConnect(patch: Patch, wire: Omit<Wire, 'id'>) {
  const { source, sourceHandle, target, targetHandle } = wire
  const signal = signalAt(patch.modules.find(node => node.id === source), 'out', sourceHandle)
  if (!signal || signal !== signalAt(patch.modules.find(node => node.id === target), 'in', targetHandle)) return false
  if (patch.wires.some(edge => edge.source === source && edge.sourceHandle === sourceHandle && edge.target === target && edge.targetHandle === targetHandle)) return false
  if (signal === 'midi') return !patch.wires.some(edge => edge.target === target && edge.targetHandle === targetHandle)

  const visited = new Set<string>()
  const pending = [target]
  while (pending.length) {
    const id = pending.pop()!
    if (id === source) return false
    if (visited.has(id)) continue
    visited.add(id)
    for (const edge of patch.wires) if (edge.source === id) pending.push(edge.target)
  }
  return true
}

export function connect(patch: Patch, connection: Omit<Wire, 'id'>): Patch {
  if (!canConnect(patch, connection)) return patch
  let wire: Wire = { ...connection, id: uid() }
  const source = patch.modules.find(node => node.id === wire.source)!
  const target = patch.modules.find(node => node.id === wire.target)!
  if (signalAt(source, 'out', wire.sourceHandle) === 'midi') return { ...patch, wires: [...patch.wires, wire] }

  let nodes = [...patch.modules]
  let wires = [...patch.wires]
  const outgoing = wires.find(edge => edge.source === wire.source && edge.sourceHandle === wire.sourceHandle)
  const incoming = wires.find(edge => edge.target === wire.target && edge.targetHandle === wire.targetHandle)
  const expand = (node: Module, direction: 'in' | 'out') => {
    const port = ports(node, direction).find(port => !wires.some(edge => direction === 'in'
      ? edge.target === node.id && edge.targetHandle === port.id
      : edge.source === node.id && edge.sourceHandle === port.id))
    if (port) return port.id
    nodes = nodes.map(item => item.id === node.id ? { ...item, count: item.count + 1 } : item)
    return direction + '-' + node.count
  }

  if (outgoing) {
    const existing = nodes.find(node => node.id === outgoing.target && node.kind === 'split' && node.auto)
    if (existing) {
      if (wires.some(edge => edge.source === existing.id && edge.target === target.id && edge.targetHandle === wire.targetHandle)) return patch
      wire = { ...wire, source: existing.id, sourceHandle: expand(existing, 'out') }
    } else {
      const split = { ...makeModule('split', { x: source.position.x + 235, y: source.position.y + 90 }), auto: true as const }
      nodes.push(split)
      wires = wires.map(edge => edge.id === outgoing.id ? { ...edge, source: split.id, sourceHandle: 'out-0' } : edge)
      wires.push({ id: uid(), source: source.id, sourceHandle: wire.sourceHandle, target: split.id, targetHandle: 'in-0' })
      wire = { ...wire, source: split.id, sourceHandle: 'out-1' }
    }
  }

  if (incoming) {
    const existing = nodes.find(node => node.id === incoming.source && node.kind === 'mix' && node.auto)
    if (existing) {
      if (wires.some(edge => edge.source === wire.source && edge.sourceHandle === wire.sourceHandle && edge.target === existing.id)) return patch
      wire = { ...wire, target: existing.id, targetHandle: expand(existing, 'in') }
    } else {
      const mix = { ...makeModule('mix', { x: target.position.x - 235, y: target.position.y - 90 }), auto: true as const }
      nodes.push(mix)
      wires = wires.map(edge => edge.id === incoming.id ? { ...edge, target: mix.id, targetHandle: 'in-0' } : edge)
      wires.push({ id: uid(), source: mix.id, sourceHandle: 'out-0', target: target.id, targetHandle: wire.targetHandle })
      wire = { ...wire, target: mix.id, targetHandle: 'in-1' }
    }
  }
  return { ...patch, modules: nodes, wires: [...wires, wire] }
}

export function remove(patch: Patch, nodeIds: Set<string>, wireIds: Set<string>): Patch {
  return {
    ...patch,
    modules: patch.modules.filter(node => !nodeIds.has(node.id)),
    wires: patch.wires.filter(wire => !nodeIds.has(wire.source) && !nodeIds.has(wire.target) && !wireIds.has(wire.id)),
    windows: Object.fromEntries(Object.entries(patch.windows).filter(([id]) => !nodeIds.has(id))),
  }
}

export function duplicate(patch: Patch, ids: Set<string>): Patch {
  const copies = new Map(patch.modules.filter(node => ids.has(node.id)).map(node => [
    node.id, { ...node, id: uid(), position: { x: node.position.x + 36, y: node.position.y + 36 } },
  ]))
  const wires = patch.wires.filter(wire => copies.has(wire.source) && copies.has(wire.target)).map(wire => ({
    ...wire, id: uid(), source: copies.get(wire.source)!.id, target: copies.get(wire.target)!.id,
  }))
  return { ...patch, modules: [...patch.modules, ...copies.values()], wires: [...patch.wires, ...wires] }
}
