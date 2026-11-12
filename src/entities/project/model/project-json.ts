import { gainRange, kinds, modules, parameterRange, waves, type Kind } from '../../audio-module/@x/project.ts'
import { canConnect, signalAt, uid, type Patch, type Project } from './patch.ts'

export function serializeProject(project: Project) {
  return JSON.stringify(project, null, 2)
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const string = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const point = (value: unknown) => object(value) && finite(value.x) && finite(value.y)
const identifier = (value: unknown): value is string => string(value) && /^[a-zA-Z0-9_-]+$/.test(value) && !Object.hasOwn(Object.prototype, value)

function validPatch(value: unknown): value is Patch {
  if (!object(value) || !Array.isArray(value.modules) || !Array.isArray(value.wires) || !object(value.windows) ||
    !point(value.viewport) || !object(value.viewport) || !finite(value.viewport.zoom) || value.viewport.zoom < 0.1 || value.viewport.zoom > 2) return false

  const ids = new Set<string>()
  for (const node of value.modules) {
    if (!object(node) || !identifier(node.id) || ids.has(node.id) || !kinds.includes(node.kind as Kind) || !point(node.position) ||
      !finite(node.count) || !Number.isInteger(node.count) || node.count < 2 ||
      !object(node.params) || (node.auto !== undefined && (node.auto !== true || (node.kind !== 'mix' && node.kind !== 'split')))) return false
    ids.add(node.id)
    if (node.oscillators !== undefined) {
      if (node.kind !== 'osc' || !Array.isArray(node.oscillators) || !node.oscillators.length) return false
      const layerIds = new Set<string>()
      for (const layer of node.oscillators) {
        if (!object(layer) || !identifier(layer.id) || layerIds.has(layer.id) ||
          !waves.includes(layer.wave as typeof waves[number]) || !finite(layer.gain) ||
          layer.gain < gainRange[0] || layer.gain > gainRange[1] || typeof layer.enabled !== 'boolean') return false
        layerIds.add(layer.id)
      }
    }
    const kind = node.kind as Kind
    const { params: defaults, dynamicPorts, optionalParams } = modules[kind]
    if (Object.keys(defaults).some(key => !optionalParams?.includes(key) && !Object.hasOwn(node.params as object, key))) return false
    for (const [key, param] of Object.entries(node.params)) {
      if (key === 'device' && Object.hasOwn(defaults, 'device') && typeof param === 'string') continue
      if (key === 'wave' && Object.hasOwn(defaults, 'wave') && waves.includes(param as typeof waves[number])) continue
      const dynamic = dynamicPorts && key.startsWith(dynamicPorts + '-') && /^\d+$/.test(key.slice(dynamicPorts.length + 1))
      if (dynamic && Number(key.split('-')[1]) >= node.count) return false
      const range = dynamic ? gainRange : Object.hasOwn(defaults, key) && parameterRange(kind, key)
      if (!range || !finite(param) || param < range[0] || param > range[1] || (range[2] === 1 && !Number.isInteger(param))) return false
    }
  }

  for (const [id, win] of Object.entries(value.windows)) {
    if (!ids.has(id) || !object(win) || !point(win) || !finite(win.width) || win.width < 260 ||
      !finite(win.height) || win.height < 180 || typeof win.minimized !== 'boolean') return false
  }

  const patch = { ...value, wires: [] } as unknown as Patch
  const wireIds = new Set<string>()
  const targets = new Set<string>()
  const outputs = new Set<string>()
  for (const wire of value.wires) {
    if (!object(wire) || !identifier(wire.id) || wireIds.has(wire.id) || !identifier(wire.source) ||
      !identifier(wire.target) || !string(wire.sourceHandle) || !string(wire.targetHandle)) return false
    const edge = { id: wire.id, source: wire.source, target: wire.target, sourceHandle: wire.sourceHandle, targetHandle: wire.targetHandle }
    if (!canConnect(patch, edge)) return false
    const target = edge.target + ':' + edge.targetHandle
    const output = edge.source + ':' + edge.sourceHandle
    const audio = signalAt(patch.modules.find(node => node.id === edge.source), 'out', edge.sourceHandle) === 'audio'
    if (targets.has(target) || (audio && outputs.has(output))) return false
    targets.add(target)
    if (audio) outputs.add(output)
    wireIds.add(edge.id)
    patch.wires.push(edge)
  }
  return true
}

export function importProject(json: string): Project {
  const value: unknown = JSON.parse(json)
  if (!object(value) || value.schemaVersion !== 1 || !string(value.name) || !validPatch(value.patch) || !Array.isArray(value.versions)) {
    throw new Error('Некорректный проект или неподдерживаемая версия JSON.')
  }
  const ids = new Set<string>()
  const versions = value.versions.map(version => {
    if (!object(version) || !identifier(version.id) || ids.has(version.id) || !string(version.name) ||
      !string(version.date) || Number.isNaN(Date.parse(version.date)) || !validPatch(version.patch)) throw new Error('Некорректная история версий.')
    ids.add(version.id)
    return { id: version.id, name: version.name, date: version.date, patch: version.patch }
  })
  return { schemaVersion: 1, id: uid(), name: value.name, patch: value.patch, versions }
}
