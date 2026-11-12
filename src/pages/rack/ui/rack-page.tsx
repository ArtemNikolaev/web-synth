import { useEffect, useRef, useState, type FormEvent } from 'react'
import './rack.css'
import { AudioModuleControls, kinds, modules } from '../../../entities/audio-module/index.ts'
import { downloadProject } from '../lib/download-project.ts'
import { useRack } from '../model/use-rack.ts'
import { RackCanvas } from '../../../widgets/rack-canvas/index.ts'
import { FloatingWindow } from './floating-window.tsx'

const catalog = (['Input', 'Through', 'Output'] as const).map(title => ({
  title,
  kinds: kinds.filter(kind => modules[kind].group === title),
}))
const statuses = { loading: 'Загрузка…', saving: 'Сохранение…', saved: 'Автосохранено', error: 'Ошибка сохранения' }
type Dialog = { title: string; label: string; value?: string; description?: string; danger?: boolean; submit: (value: string) => void | Promise<unknown> }

export function RackPage() {
  const rack = useRack()
  const { project, library, engine } = rack
  const patch = project?.patch
  const file = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<'projects' | 'catalog' | 'history'>()
  const [dialog, setDialog] = useState<Dialog>()
  const [dialogValue, setDialogValue] = useState('')
  const [context, setContext] = useState<{ id: string; x: number; y: number; selection: Set<string> }>()
  const [windowOrder, setWindowOrder] = useState<string[]>([])
  const [audioError, setAudioError] = useState('')
  const [audioPending, setAudioPending] = useState(false)
  useEffect(() => {
    setWindowOrder([])
  }, [project?.id])

  async function toggleAudio() {
    const wasActive = engine.active
    setAudioPending(true)
    setAudioError('')
    try {
      if (wasActive) await engine.stop()
      else await engine.start()
    } catch {
      setAudioError(wasActive ? 'Не удалось выключить звук. Попробуйте ещё раз.' : 'Не удалось включить звук. Попробуйте ещё раз.')
    } finally {
      setAudioPending(false)
    }
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

  function copy(ids: Set<string>) {
    rack.duplicateModules(ids)
    setContext(undefined)
  }

  function erase(ids: Set<string>, wires = new Set<string>()) {
    rack.removeSelection(ids, wires)
    setContext(undefined)
  }

  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setMenu(undefined)
      setDialog(undefined)
      setContext(undefined)
    }
    window.addEventListener('keydown', dismiss)
    return () => window.removeEventListener('keydown', dismiss)
  }, [])

  function focus(id: string) {
    setWindowOrder(order => [...order.filter(item => item !== id), id])
  }

  function openWindow(id: string) {
    const existing = patch?.windows[id]
    const offset = (Object.keys(patch?.windows ?? {}).length % 7) * 26
    const kind = patch?.modules.find(node => node.id === id)?.kind
    const height = (kind && modules[kind].windowHeight) || 336
    rack.changeWindow(id, existing ? { ...existing, minimized: false } : {
      x: window.innerWidth - 408 - offset, y: window.innerHeight * 0.43 + offset, width: 382, height, minimized: false,
    })
    focus(id)
  }

  if (!project || !patch || !library) return <main className="loading">{rack.error || 'Загрузка Modular Audio Rack…'}</main>

  async function closeMenuAfter(action: Promise<boolean>) {
    if (await action) setMenu(undefined)
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
                if (item.id === project.id || await rack.selectProject(item.id)) setMenu(undefined)
              }}>{item.name}{item.id === project.id && <span aria-hidden="true">✓</span>}</button>)}
            </div>
            <div className="menu-actions">
              <button onClick={() => ask({ title: 'Новый проект', label: 'Создать проект', value: '', submit: name => closeMenuAfter(rack.createProject(name)) })}>Создать проект</button>
              <button onClick={() => ask({ title: 'Переименовать проект', label: 'Сохранить', value: project.name, submit: name => rack.renameProject(name) })}>Переименовать</button>
              <button onClick={() => closeMenuAfter(rack.duplicateProject(project))}>Дублировать</button>
              <button onClick={() => file.current?.click()}>Импорт JSON</button>
              <button onClick={() => downloadProject(project)}>Экспорт JSON</button>
              <button className="danger" onClick={() => ask({ title: 'Удалить проект?', label: 'Удалить проект', description: project.name, danger: true, submit: () => closeMenuAfter(rack.deleteProject(project.id)) })}>Удалить проект</button>
            </div>
          </div>}
        </div>
        <input type="file" accept=".json,application/json" hidden ref={file} onChange={async event => {
          const input = event.currentTarget
          const selectedFile = input.files?.[0]
          input.value = ''
          if (!selectedFile) return
          await closeMenuAfter(rack.importFile(selectedFile))
        }} />
        <div className="toolbar-spacer" />
        <span className={'save-status ' + rack.status} role="status"><i />{statuses[rack.status]}</span>
        <button className={engine.active ? 'audio-active' : 'primary'} onClick={toggleAudio} disabled={audioPending}>
          {engine.active ? 'Выключить звук' : 'Включить звук'}
        </button>
        <button onClick={() => ask({
          title: 'Сохранить версию', label: 'Сохранить версию', value: '',
          submit: rack.saveVersion,
        })}>Сохранить версию</button>
        <button className={menu === 'history' ? 'current' : ''} onClick={() => toggle('history')} aria-expanded={menu === 'history'}>История версий</button>
      </header>

      <RackCanvas patch={patch} projectId={project.id} commands={rack} shortcutsBlocked={Boolean(dialog)}
        catalogOpen={menu === 'catalog'} toggleCatalog={() => toggle('catalog')}
        openModule={openWindow} onPaneClick={() => { setMenu(undefined); setContext(undefined) }}
        onContextMenu={(id, x, y, selection) => { setMenu(undefined); setContext({ id, x, y, selection }) }}
        onEdit={() => setContext(undefined)} onAdd={() => setMenu(undefined)}
        renderCatalog={add => menu === 'catalog' && <div className="popover catalog">
            {catalog.map(group => <section key={group.title}><h2>{group.title}</h2>
              {group.kinds.map(kind => <button key={kind} onClick={() => add(kind)}>{modules[kind].title}</button>)}
            </section>)}
          </div>} />

      <footer>Shift + клик — выделение <span>·</span> Пробел + перетаскивание — панорамирование <span>·</span> Двойной клик — параметры</footer>

      {patch.modules.map(node => {
        const win = patch.windows[node.id]
        if (!win) return null
        return <FloatingWindow key={project.id + node.id} title={modules[node.kind].title + ' · параметры'} win={win}
          z={20 + Math.max(0, windowOrder.indexOf(node.id))} focus={() => focus(node.id)} close={() => rack.changeWindow(node.id)}
          change={next => rack.changeWindow(node.id, next)}>
          <AudioModuleControls node={node} engine={engine} begin={rack.begin} end={rack.end}
            setParam={(key, value, transient) => rack.setParam(node.id, key, value, transient)}
            changeOscillators={(change, transient) => rack.changeOscillators(node.id, change, transient)}
            grow={() => rack.growModule(node.id)} />
        </FloatingWindow>
      })}

      {menu === 'history' && <aside className="popover history">
        <div className="panel-title"><h2>История версий</h2><button aria-label="Закрыть историю" onClick={() => setMenu(undefined)}>×</button></div>
        {!project.versions.length && <p>Сохраните именованную версию, чтобы вернуться к ней позже.</p>}
        {[...project.versions].reverse().map(version => <section key={version.id} className="version">
          <strong>{version.name}</strong><time dateTime={version.date}>{new Date(version.date).toLocaleString('ru-RU')}</time>
          <div className="version-actions">
            <button onClick={() => rack.restoreVersion(version)}>Восстановить</button>
            <button onClick={() => ask({
              title: 'Переименовать версию', label: 'Сохранить', value: version.name,
              submit: name => rack.renameVersion(version.id, name),
            })}>Переименовать</button>
            <button className="danger" onClick={() => ask({
              title: 'Удалить версию?', description: version.name, label: 'Удалить версию', danger: true,
              submit: () => rack.deleteVersion(version.id),
            })}>Удалить</button>
          </div>
        </section>)}
      </aside>}

      {context && <div className="popover context-menu" style={{ left: context.x, top: context.y }} onPointerDown={event => event.stopPropagation()}>
        <button onClick={() => { openWindow(context.id); setContext(undefined) }}>Параметры</button>
        <button onClick={() => copy(context.selection)}>Дублировать</button>
        <button className="danger" onClick={() => erase(context.selection)}>Удалить</button>
      </div>}
      {(rack.error || audioError || rack.status === 'error') && <div className="notice" role="alert">
        <span>{rack.error || audioError || 'Изменения не сохранены. Выгрузите проект в JSON.'}</span>
        {rack.status === 'error' && <button onClick={() => downloadProject(project)}>Экспорт JSON</button>}
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
