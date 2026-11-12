import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background, BackgroundVariant, BaseEdge, ConnectionLineType, getSmoothStepPath, ReactFlow, ReactFlowProvider,
  SelectionMode, useReactFlow, type Connection, type Edge, type EdgeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './rack-canvas.css'
import type { Kind, Point } from '../../../entities/audio-module/index.ts'
import { signalAt, type Patch, type Wire } from '../../../entities/project/index.ts'
import { nodeTypes, type RackNode } from './rack-node.tsx'

type RackEdge = Edge<{ signal: string }, 'cable'>
function Cable(props: EdgeProps<RackEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 0, offset: 24 })
  return <BaseEdge id={props.id} path={path} interactionWidth={18} style={props.style} className={props.data?.signal} />
}
const edgeTypes = { cable: Cable }
type CanvasCommands = {
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  begin: () => void
  end: () => void
  step: (direction: 'undo' | 'redo') => void
  addModule: (kind: Kind, point: Point) => string
  moveModules: (positions: ReadonlyMap<string, Point>) => void
  duplicateModules: (ids: Set<string>) => void
  removeSelection: (ids: Set<string>, wires: Set<string>) => void
  canAttach: (wire: Omit<Wire, 'id'>) => boolean
  attach: (wire: Omit<Wire, 'id'>, record: boolean) => void
  detach: (id: string) => void
  changeViewport: (viewport: Patch['viewport']) => void
}

type RackCanvasProps = {
  patch: Patch
  projectId: string
  commands: CanvasCommands
  shortcutsBlocked: boolean
  catalogOpen: boolean
  toggleCatalog: () => void
  openModule: (id: string) => void
  onPaneClick: () => void
  onContextMenu: (id: string, x: number, y: number, selection: Set<string>) => void
  onEdit: () => void
  onAdd: () => void
  renderCatalog: (add: (kind: Kind) => void) => ReactNode
}

export function RackCanvas(props: RackCanvasProps) {
  return <ReactFlowProvider><CanvasSurface {...props} /></ReactFlowProvider>
}

function CanvasSurface({
  patch, projectId, commands, shortcutsBlocked, catalogOpen, toggleCatalog, openModule,
  onPaneClick, onContextMenu, onEdit, onAdd, renderCatalog,
}: RackCanvasProps) {
  const flow = useReactFlow<RackNode, RackEdge>()
  const canvas = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  const [measurements, setMeasurements] = useState<Record<string, NonNullable<RackNode['measured']>>>({})
  const [reconnecting, setReconnecting] = useState<Wire>()
  const [panning, setPanning] = useState(false)

  const nodes = useMemo(() => patch.modules.map(module => ({
    id: module.id, position: module.position, type: 'rack' as const, data: { module },
    selected: selected.has(module.id), measured: measurements[module.id],
  })), [patch.modules, selected, measurements])

  const edges = useMemo(() => {
    const wires = reconnecting ? [...patch.wires, reconnecting] : patch.wires
    return wires.map(wire => ({
      ...wire, type: 'cable' as const,
      data: { signal: signalAt(patch.modules.find(node => node.id === wire.source), 'out', wire.sourceHandle) ?? 'audio' },
      selected: selectedEdges.has(wire.id),
      style: reconnecting?.id === wire.id ? { opacity: 0, pointerEvents: 'none' as const } : undefined,
    }))
  }, [patch.wires, patch.modules, reconnecting, selectedEdges])

  useEffect(() => {
    setSelected(new Set())
    setSelectedEdges(new Set())
  }, [projectId])

  function fit() {
    if (nodes.length) void flow.fitView({ duration: 180, padding: 0.18 })
    else void flow.setViewport({ x: 0, y: 0, zoom: 1 })
  }

  function copy(ids: Set<string>) {
    commands.duplicateModules(ids)
    onEdit()
  }

  function erase(ids: Set<string>, wires: Set<string>) {
    commands.removeSelection(ids, wires)
    onEdit()
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : undefined
      if (shortcutsBlocked || commands.busy || target?.closest('input, select, textarea, [contenteditable]')) return
      if (event.code === 'Space' && !target?.closest('button')) {
        setPanning(true)
        event.preventDefault()
      }
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && ['KeyZ', 'KeyD', 'Digit0'].includes(event.code)) {
        event.preventDefault()
        if (reconnecting) return
        if (event.code === 'KeyZ') commands.step(event.shiftKey ? 'redo' : 'undo')
        if (event.code === 'KeyD') copy(selected)
        if (event.code === 'Digit0') fit()
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !reconnecting && (selected.size || selectedEdges.size)) {
        event.preventDefault()
        erase(selected, selectedEdges)
      }
    }
    const release = (event: KeyboardEvent) => { if (event.code === 'Space') setPanning(false) }
    const blur = () => setPanning(false)
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', blur)
    }
  })

  function changeNodes(changes: NodeChange<RackNode>[]) {
    const dimensions = changes.flatMap(change => change.type === 'dimensions' && change.dimensions
      ? [[change.id, change.dimensions] as const] : [])
    if (dimensions.length) setMeasurements(previous => {
      const updated = dimensions.filter(([id, size]) => previous[id]?.width !== size.width || previous[id]?.height !== size.height)
      return updated.length ? { ...previous, ...Object.fromEntries(updated) } : previous
    })
    const selection = changes.filter(change => change.type === 'select')
    if (selection.length) setSelected(previous => {
      const ids = new Set(previous)
      for (const change of selection) {
        if (change.selected) ids.add(change.id)
        else ids.delete(change.id)
      }
      return ids
    })
    const positions = new Map(changes.flatMap(change => change.type === 'position' && change.position ? [[change.id, change.position] as const] : []))
    commands.moveModules(positions)
  }

  function valid(connection: Connection | RackEdge) {
    return Boolean(connection.sourceHandle && connection.targetHandle && commands.canAttach({
      source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle,
    }))
  }

  function attach(connection: Connection, record = true) {
    if (!connection.sourceHandle || !connection.targetHandle) return
    const wire = { ...connection, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle }
    commands.attach(wire, record)
  }

  function add(kind: Kind) {
    if (!canvas.current) return
    const rect = canvas.current.getBoundingClientRect()
    const point = flow.screenToFlowPosition({ x: rect.left + rect.width * 0.42 - 80, y: rect.top + rect.height * 0.42 - 40 })
    const id = commands.addModule(kind, point)
    setSelected(new Set([id]))
    setSelectedEdges(new Set())
    onAdd()
  }

  return <div className="canvas" ref={canvas}>
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      viewport={patch.viewport} onViewportChange={commands.changeViewport}
      onNodesChange={changeNodes} onEdgesChange={changes => {
        const changesToSelection = changes.filter(change => change.type === 'select')
        if (changesToSelection.length) setSelectedEdges(previous => {
          const ids = new Set(previous)
          for (const change of changesToSelection) {
            if (change.selected) ids.add(change.id)
            else ids.delete(change.id)
          }
          return ids
        })
      }}
      onPaneClick={onPaneClick}
      onNodeDoubleClick={(_, node) => openModule(node.id)}
      onNodeContextMenu={(event, node) => {
        event.preventDefault()
        onContextMenu(node.id, Math.min(event.clientX, innerWidth - 184), Math.min(event.clientY, innerHeight - 145), selected.has(node.id) ? selected : new Set([node.id]))
      }}
      onNodeDragStart={commands.begin} onNodeDragStop={commands.end}
      onSelectionDragStart={commands.begin} onSelectionDragStop={commands.end}
      onConnect={connection => attach(connection)} isValidConnection={valid}
      onReconnectStart={(_, edge) => {
        const wire = patch.wires.find(item => item.id === edge.id)
        if (!wire) return
        commands.begin()
        setReconnecting(wire)
        commands.detach(edge.id)
      }}
      onReconnect={(_, connection) => attach(connection, false)}
      onReconnectEnd={() => { setReconnecting(undefined); commands.end() }}
      nodesConnectable={!commands.busy} selectionOnDrag={!panning} selectionMode={SelectionMode.Partial} selectionKeyCode={null}
      multiSelectionKeyCode="Shift" panOnDrag={panning ? [0, 1] : [1]} panActivationKeyCode={null}
      zoomOnDoubleClick={false} deleteKeyCode={null} minZoom={0.1} maxZoom={2}
      connectionLineType={ConnectionLineType.Step}
    >
      <Background variant={BackgroundVariant.Lines} gap={24} color="#26364b" lineWidth={0.75} />
    </ReactFlow>

    <div className="canvas-tools">
      <button className="add primary" aria-label="Добавить узел" aria-expanded={catalogOpen} onClick={toggleCatalog}>+</button>
      <div className="tool-group">
        <button aria-label="Отменить" title="Ctrl+Z" disabled={!commands.canUndo || Boolean(reconnecting)} onClick={() => commands.step('undo')}>↶</button>
        <button aria-label="Повторить" title="Ctrl+Shift+Z" disabled={!commands.canRedo || Boolean(reconnecting)} onClick={() => commands.step('redo')}>↷</button>
      </div>
      {renderCatalog(add)}
    </div>
    {patch.modules.length === 0 && <div className="empty">
      <div className="empty-icon" aria-hidden="true">∿</div>
      <h2>Соберите первый патч</h2>
      <p>Добавьте Oscillator и Output, затем соедините их порты.</p>
      <button className="primary" onClick={toggleCatalog}>Добавить узел</button>
    </div>}
    <div className="zoom tool-group">
      <button aria-label="Уменьшить" onClick={() => flow.zoomOut({ duration: 120 })}>−</button>
      <button className="zoom-value" title="Вся схема · Ctrl+0" aria-label="Показать всю схему" onClick={fit}>{Math.round(patch.viewport.zoom * 100)}%</button>
      <button aria-label="Увеличить" onClick={() => flow.zoomIn({ duration: 120 })}>+</button>
    </div>
  </div>
}
