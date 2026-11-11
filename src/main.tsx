import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Background, BackgroundVariant, BaseEdge, ConnectionLineType, getSmoothStepPath, ReactFlow,
  ReactFlowProvider, SelectionMode, useReactFlow, type Connection, type Edge, type EdgeProps,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './style.css'
import {
  canConnect, connect, createProject, duplicate, makeModule, modules, remove, signalAt, uid,
  type Kind, type WindowState, type Wire,
} from './model.ts'
import { exportProject, importProject } from './storage.ts'
import { useRack } from './useRack.ts'
import { FloatingWindow, nodeTypes, WidgetControls, type RackNode } from './widgets.tsx'

type RackEdge = Edge<{ signal: string }, 'cable'>
function Cable(props: EdgeProps<RackEdge>) {
  const [path] = getSmoothStepPath({ ...props, borderRadius: 0, offset: 24 })
  return <BaseEdge id={props.id} path={path} interactionWidth={18} style={props.style} className={props.data?.signal} />
}
const edgeTypes = { cable: Cable }
const catalog: { title: string; kinds: Kind[] }[] = [
  { title: 'Input', kinds: ['osc', 'midi'] },
  { title: 'Through', kinds: ['synth', 'mix', 'split'] },
  { title: 'Output', kinds: ['out'] },
]
const statuses = { loading: 'Загрузка…', saving: 'Сохранение…', saved: 'Автосохранено', error: 'Ошибка сохранения' }
type Dialog = { title: string; label: string; value?: string; description?: string; danger?: boolean; submit: (value: string) => void | Promise<unknown> }

function Rack() {
  const rack = useRack()
  const { project, library, engine } = rack
  const patch = project?.patch
  const flow = useReactFlow<RackNode, RackEdge>()
  const canvas = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<'projects' | 'catalog' | 'history'>()
  const [dialog, setDialog] = useState<Dialog>()
  const [dialogValue, setDialogValue] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set())
  const [measurements, setMeasurements] = useState<Record<string, NonNullable<RackNode['measured']>>>({})
  const [reconnecting, setReconnecting] = useState<Wire>()
  const [context, setContext] = useState<{ id: string; x: number; y: number }>()
  const [windowOrder, setWindowOrder] = useState<string[]>([])
  const [audioError, setAudioError] = useState('')
  const [panning, setPanning] = useState(false)

  const nodes = useMemo(() => patch?.modules.map(module => ({
    id: module.id, position: module.position, type: 'rack' as const, data: { module },
    selected: selected.has(module.id), measured: measurements[module.id],
  })) ?? [], [patch?.modules, selected, measurements])

  const edges = useMemo(() => {
    if (!patch) return []
    const wires = reconnecting ? [...patch.wires, reconnecting] : patch.wires
    return wires.map(wire => ({
      ...wire, type: 'cable' as const,
      data: { signal: signalAt(patch.modules.find(node => node.id === wire.source), 'out', wire.sourceHandle) ?? 'audio' },
      selected: selectedEdges.has(wire.id),
      style: reconnecting?.id === wire.id ? { opacity: 0, pointerEvents: 'none' as const } : undefined,
    }))
  }, [patch?.wires, patch?.modules, reconnecting, selectedEdges])

  useEffect(() => {
    setSelected(new Set())
    setSelectedEdges(new Set())
    setWindowOrder([])
  }, [project?.id])

  const edit = rack.updatePatch

  function startAudio() {
    setAudioError('')
    void engine.start().catch(() => setAudioError('Не удалось включить аудио. Попробуйте ещё раз.'))
  }

  function toggle(next: typeof menu) {
    setContext(undefined)
    setMenu(menu === next ? undefined : next)
  }

  function ask(next: Dialog) {
    setDialogValue(next.value ?? '')
    setDialog(next)
    setContext(undefined)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!dialog) return
    const value = dialogValue.trim()
    if (dialog.value !== undefined && !value) return
    void dialog.submit(value)
    setDialog(undefined)
  }

  function fit() {
    if (nodes.length) void flow.fitView({ duration: 180, padding: 0.18 })
    else void flow.setViewport({ x: 0, y: 0, zoom: 1 })
  }

  function copy(ids: Set<string>) {
    if (ids.size) edit(current => duplicate(current, ids))
    setContext(undefined)
  }

  function erase(ids: Set<string>, wires = new Set<string>()) {
    if (ids.size || wires.size) edit(current => remove(current, ids, wires))
    setContext(undefined)
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenu(undefined)
        setDialog(undefined)
        setContext(undefined)
        return
      }
      const target = event.target instanceof HTMLElement ? event.target : undefined
      if (dialog || rack.busy || target?.closest('input, select, textarea, [contenteditable]')) return
      if (event.code === 'Space' && !target?.closest('button')) {
        setPanning(true)
        event.preventDefault()
      }
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && ['KeyZ', 'KeyD', 'Digit0'].includes(event.code)) {
        event.preventDefault()
        if (reconnecting) return
        if (event.code === 'KeyZ') rack.step(event.shiftKey ? 'redo' : 'undo')
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
    if (positions.size) edit(current => {
      const moved = current.modules.map(module => {
        const position = positions.get(module.id)
        return position && (position.x !== module.position.x || position.y !== module.position.y) ? { ...module, position } : module
      })
      return moved.some((module, index) => module !== current.modules[index]) ? { ...current, modules: moved } : current
    }, false)
  }

  function valid(connection: Connection | RackEdge) {
    const current = rack.currentPatch()
    return Boolean(current && connection.sourceHandle && connection.targetHandle && canConnect(current, {
      source: connection.source, target: connection.target, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle,
    }))
  }

  function attach(connection: Connection, record = true) {
    if (!connection.sourceHandle || !connection.targetHandle) return
    const wire = { ...connection, sourceHandle: connection.sourceHandle, targetHandle: connection.targetHandle }
    edit(current => connect(current, wire), record)
  }

  function add(kind: Kind) {
    if (!canvas.current) return
    const rect = canvas.current.getBoundingClientRect()
    const point = flow.screenToFlowPosition({ x: rect.left + rect.width * 0.42 - 80, y: rect.top + rect.height * 0.42 - 40 })
    const node = makeModule(kind, point)
    while (patch?.modules.some(item => Math.abs(item.position.x - point.x) < 190 && Math.abs(item.position.y - point.y) < 105)) {
      point.x += 48
      point.y += 40
    }
    edit(current => ({ ...current, modules: [...current.modules, node] }))
    setSelected(new Set([node.id]))
    setSelectedEdges(new Set())
    setMenu(undefined)
  }

  function focus(id: string) {
    setWindowOrder(order => [...order.filter(item => item !== id), id])
  }

  function changeWindow(id: string, win?: WindowState) {
    edit(current => {
      const windows = { ...current.windows }
      if (win) windows[id] = win
      else delete windows[id]
      return { ...current, windows }
    }, false)
  }

  function openWindow(id: string) {
    const existing = patch?.windows[id]
    const offset = (Object.keys(patch?.windows ?? {}).length % 7) * 26
    changeWindow(id, existing ? { ...existing, minimized: false } : {
      x: window.innerWidth - 408 - offset, y: window.innerHeight * 0.43 + offset, width: 382, height: 336, minimized: false,
    })
    focus(id)
  }

  if (!project || !patch || !library) return <main className="loading">{rack.error || 'Загрузка Modular Audio Rack…'}</main>

  async function addProject(next: typeof project) {
    if (!next) return
    if (await rack.changeLibrary(current => ({ current: next.id, projects: [...current.projects, next] }))) setMenu(undefined)
  }

  return <main className="app" onPointerDown={() => { if (context) setContext(undefined) }}>
    <div className="workspace" inert={rack.busy || Boolean(dialog)}>
      <header className="toolbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">∿</span><h1>Modular Audio Rack</h1></div>
        <div className="project-control">
          <button className="project-button" onClick={() => toggle('projects')} aria-expanded={menu === 'projects'}>
            <span>{project.name}</span><span aria-hidden="true">⌄</span>
          </button>
          {menu === 'projects' && <div className="popover project-menu">
            <div className="project-list">
              {library.projects.map(item => <button key={item.id} className={item.id === project.id ? 'current' : ''} onClick={async () => {
                if (item.id === project.id || await rack.changeLibrary(current => ({ ...current, current: item.id }))) setMenu(undefined)
              }}>{item.name}{item.id === project.id && <span aria-hidden="true">✓</span>}</button>)}
            </div>
            <div className="menu-actions">
              <button onClick={() => ask({ title: 'Новый проект', label: 'Создать проект', value: '', submit: name => addProject(createProject(name)) })}>Создать проект</button>
              <button onClick={() => ask({ title: 'Переименовать проект', label: 'Сохранить', value: project.name, submit: name => rack.updateProject(item => ({ ...item, name })) })}>Переименовать</button>
              <button onClick={() => addProject({ ...project, id: uid(), name: project.name + ' (копия)' })}>Дублировать</button>
              <button onClick={() => file.current?.click()}>Импорт JSON</button>
              <button onClick={() => exportProject(project)}>Экспорт JSON</button>
              <button className="danger" onClick={() => ask({ title: 'Удалить проект?', label: 'Удалить проект', description: project.name, danger: true, submit: async () => {
                if (await rack.changeLibrary(current => {
                  const projects = current.projects.filter(item => item.id !== project.id)
                  if (!projects.length) projects.push(createProject('Новый проект'))
                  return { projects, current: projects[0].id }
                })) setMenu(undefined)
              } })}>Удалить проект</button>
            </div>
          </div>}
        </div>
        <input type="file" accept=".json,application/json" hidden ref={file} onChange={async event => {
          const input = event.currentTarget
          const selectedFile = input.files?.[0]
          input.value = ''
          if (!selectedFile) return
          try { await addProject(importProject(await selectedFile.text())) }
          catch { rack.setError('Не удалось импортировать проект. Проверьте формат и версию JSON.') }
        }} />
        <div className="toolbar-spacer" />
        <span className={'save-status ' + rack.status} role="status"><i />{statuses[rack.status]}</span>
        <button className={engine.active ? 'audio-active' : 'primary'} onClick={startAudio} disabled={engine.active}>{engine.active ? 'Звук включён' : 'Включить звук'}</button>
        <button onClick={() => ask({
          title: 'Сохранить версию', label: 'Сохранить версию', value: '',
          submit: name => rack.updateProject(item => ({
            ...item, versions: [...item.versions, { id: uid(), name, date: new Date().toISOString(), patch: item.patch }],
          })),
        })}>Сохранить версию</button>
        <button className={menu === 'history' ? 'current' : ''} onClick={() => toggle('history')} aria-expanded={menu === 'history'}>История версий</button>
      </header>

      <div className="canvas" ref={canvas}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
          viewport={patch.viewport} onViewportChange={viewport => edit(current => ({ ...current, viewport }), false)}
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
          onPaneClick={() => { setMenu(undefined); setContext(undefined) }}
          onNodeDoubleClick={(_, node) => openWindow(node.id)}
          onNodeContextMenu={(event, node) => {
            event.preventDefault()
            setMenu(undefined)
            setContext({ id: node.id, x: Math.min(event.clientX, innerWidth - 184), y: Math.min(event.clientY, innerHeight - 145) })
          }}
          onNodeDragStart={rack.begin} onNodeDragStop={rack.end}
          onSelectionDragStart={rack.begin} onSelectionDragStop={rack.end}
          onConnect={connection => attach(connection)} isValidConnection={valid}
          onReconnectStart={(_, edge) => {
            const wire = patch.wires.find(item => item.id === edge.id)
            if (!wire) return
            rack.begin()
            setReconnecting(wire)
            edit(current => ({ ...current, wires: current.wires.filter(item => item.id !== edge.id) }), false)
          }}
          onReconnect={(_, connection) => attach(connection, false)}
          onReconnectEnd={() => { setReconnecting(undefined); rack.end() }}
          nodesConnectable={!rack.busy} selectionOnDrag={!panning} selectionMode={SelectionMode.Partial} selectionKeyCode={null}
          multiSelectionKeyCode="Shift" panOnDrag={panning ? [0, 1] : [1]} panActivationKeyCode={null}
          zoomOnDoubleClick={false} deleteKeyCode={null} minZoom={0.1} maxZoom={2}
          connectionLineType={ConnectionLineType.Step}
        >
          <Background variant={BackgroundVariant.Lines} gap={24} color="#26364b" lineWidth={0.75} />
        </ReactFlow>

        <div className="canvas-tools">
          <button className="add primary" aria-label="Добавить узел" aria-expanded={menu === 'catalog'} onClick={() => toggle('catalog')}>+</button>
          <div className="tool-group">
            <button aria-label="Отменить" title="Ctrl+Z" disabled={!rack.canUndo || Boolean(reconnecting)} onClick={() => rack.step('undo')}>↶</button>
            <button aria-label="Повторить" title="Ctrl+Shift+Z" disabled={!rack.canRedo || Boolean(reconnecting)} onClick={() => rack.step('redo')}>↷</button>
          </div>
          {menu === 'catalog' && <div className="popover catalog">
            {catalog.map(group => <section key={group.title}><h2>{group.title}</h2>
              {group.kinds.map(kind => <button key={kind} onClick={() => add(kind)}>{modules[kind].title}</button>)}
            </section>)}
          </div>}
        </div>
        {patch.modules.length === 0 && <div className="empty">
          <div className="empty-icon" aria-hidden="true">∿</div>
          <h2>Соберите первый патч</h2>
          <p>Добавьте Oscillator и Output, затем соедините их порты.</p>
          <button className="primary" onClick={() => toggle('catalog')}>Добавить узел</button>
        </div>}
        <div className="zoom tool-group">
          <button aria-label="Уменьшить" onClick={() => flow.zoomOut({ duration: 120 })}>−</button>
          <button className="zoom-value" title="Вся схема · Ctrl+0" aria-label="Показать всю схему" onClick={fit}>{Math.round(patch.viewport.zoom * 100)}%</button>
          <button aria-label="Увеличить" onClick={() => flow.zoomIn({ duration: 120 })}>+</button>
        </div>
      </div>

      <footer>Shift + клик — выделение <span>·</span> Пробел + перетаскивание — панорамирование <span>·</span> Двойной клик — параметры</footer>

      {patch.modules.map(node => {
        const win = patch.windows[node.id]
        if (!win) return null
        return <FloatingWindow key={project.id + node.id} title={modules[node.kind].title + ' · параметры'} win={win}
          z={20 + Math.max(0, windowOrder.indexOf(node.id))} focus={() => focus(node.id)} close={() => changeWindow(node.id)}
          change={next => changeWindow(node.id, next)}>
          <WidgetControls node={node} engine={engine} begin={rack.begin} end={rack.end}
            setParam={(key, value, transient) => edit(current => ({
              ...current, modules: current.modules.map(item => item.id === node.id ? { ...item, params: { ...item.params, [key]: value } } : item),
            }), !transient)}
            grow={() => edit(current => ({ ...current, modules: current.modules.map(item => item.id === node.id ? { ...item, count: item.count + 1 } : item) }))} />
        </FloatingWindow>
      })}

      {menu === 'history' && <aside className="popover history">
        <div className="panel-title"><h2>История версий</h2><button aria-label="Закрыть историю" onClick={() => setMenu(undefined)}>×</button></div>
        {!project.versions.length && <p>Сохраните именованную версию, чтобы вернуться к ней позже.</p>}
        {[...project.versions].reverse().map(version => <section key={version.id} className="version">
          <strong>{version.name}</strong><time dateTime={version.date}>{new Date(version.date).toLocaleString('ru-RU')}</time>
          <div className="version-actions">
            <button onClick={() => edit(() => version.patch)}>Восстановить</button>
            <button onClick={() => ask({
              title: 'Переименовать версию', label: 'Сохранить', value: version.name,
              submit: name => rack.updateProject(item => ({ ...item, versions: item.versions.map(entry => entry.id === version.id ? { ...entry, name } : entry) })),
            })}>Переименовать</button>
            <button className="danger" onClick={() => ask({
              title: 'Удалить версию?', description: version.name, label: 'Удалить версию', danger: true,
              submit: () => rack.updateProject(item => ({ ...item, versions: item.versions.filter(entry => entry.id !== version.id) })),
            })}>Удалить</button>
          </div>
        </section>)}
      </aside>}

      {context && <div className="popover context-menu" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}>
        <button onClick={() => { openWindow(context.id); setContext(undefined) }}>Параметры</button>
        <button onClick={() => copy(selected.has(context.id) ? selected : new Set([context.id]))}>Дублировать</button>
        <button className="danger" onClick={() => erase(selected.has(context.id) ? selected : new Set([context.id]))}>Удалить</button>
      </div>}
      {(rack.error || audioError || rack.status === 'error') && <div className="notice" role="alert">
        <span>{rack.error || audioError || 'Изменения не сохранены. Выгрузите проект в JSON.'}</span>
        {rack.status === 'error' && <button onClick={() => exportProject(project)}>Экспорт JSON</button>}
        {(rack.error || audioError) && <button aria-label="Закрыть уведомление" onClick={() => { rack.setError(''); setAudioError('') }}>×</button>}
      </div>}
    </div>

    {dialog && <div className="modal-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setDialog(undefined) }}>
      <form className="modal" aria-label={dialog.title} role="dialog" aria-modal="true" onSubmit={submit}>
        <h2>{dialog.title}</h2>
        {dialog.description && <p>{dialog.description}</p>}
        {dialog.value !== undefined && <label className="field">Название
          <input autoFocus required maxLength={120} value={dialogValue} onChange={event => setDialogValue(event.target.value)} />
        </label>}
        <div className="modal-actions"><button type="button" onClick={() => setDialog(undefined)}>Отмена</button>
          <button className={dialog.danger ? 'danger-button' : 'primary'} disabled={dialog.value !== undefined && !dialogValue.trim()}>{dialog.label}</button>
        </div>
      </form>
    </div>}
  </main>
}

createRoot(document.getElementById('root')!).render(<ReactFlowProvider><Rack /></ReactFlowProvider>)
