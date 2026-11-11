import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioEngine } from './audio.ts'
import { emptyPatch, type Patch, type Project } from './model.ts'
import { loadLibrary, saveLibrary } from './storage.ts'

type Library = Awaited<ReturnType<typeof loadLibrary>>
type SaveStatus = 'loading' | 'saving' | 'saved' | 'error'
const active = (library: Library) => library.projects.find(project => project.id === library.current)!

export function useRack() {
  const [library, setLibrary] = useState<Library>()
  const state = useRef<Library>(undefined)
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const changingLibrary = useRef(false)
  const [, refresh] = useState(0)
  const [engine] = useState(() => new AudioEngine(() => refresh(value => value + 1)))
  const queue = useRef<Promise<void>>(Promise.resolve())
  const saved = useRef<Library>(undefined)
  const timer = useRef<number>(undefined)
  const undo = useRef<Patch[]>([])
  const redo = useRef<Patch[]>([])
  const gesture = useRef<Patch>(undefined)

  useEffect(() => {
    let mounted = true
    void loadLibrary().then(initial => {
      if (!mounted) return
      state.current = saved.current = initial
      setLibrary(initial)
      engine.sync(active(initial).patch)
      setStatus('saved')
    }).catch(() => {
      if (!mounted) return
      setError('Не удалось открыть локальное хранилище. Проверьте настройки браузера и обновите страницу.')
      setStatus('error')
    })
    return () => { mounted = false }
  }, [engine])

  const save = useCallback((snapshot: Library) => {
    const task = queue.current.catch(() => {}).then(async () => {
      if (saved.current !== snapshot) await saveLibrary(snapshot)
      saved.current = snapshot
      if (state.current === snapshot) setStatus('saved')
    })
    queue.current = task
    void task.catch(() => { if (state.current === snapshot) setStatus('error') })
    return task
  }, [])

  useEffect(() => {
    const flush = () => {
      if (state.current && state.current !== saved.current) void save(state.current)
    }
    const visibility = () => { if (document.visibilityState === 'hidden') flush() }
    const guard = (event: BeforeUnloadEvent) => {
      if (state.current === saved.current) return
      flush()
      event.preventDefault()
      event.returnValue = true
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('beforeunload', guard)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('beforeunload', guard)
      window.clearTimeout(timer.current)
    }
  }, [save])

  function publish(next: Library) {
    const previous = state.current
    state.current = next
    setLibrary(next)
    if (previous?.current !== next.current) engine.sync(emptyPatch())
    if (!previous || previous.current !== next.current || active(previous).patch !== active(next).patch) engine.sync(active(next).patch)
  }

  function updateProject(change: (project: Project) => Project) {
    if (!state.current || changingLibrary.current) return
    const current = state.current
    const project = active(current)
    const next = change(project)
    if (next === project) return
    publish({ ...current, projects: current.projects.map(item => item.id === next.id ? next : item) })
    setStatus('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { if (state.current) void save(state.current) }, 350)
  }

  function remember(patch: Patch) {
    undo.current = [...undo.current.slice(-99), patch]
    redo.current = []
  }

  function updatePatch(change: (patch: Patch) => Patch, record = true) {
    updateProject(project => {
      const patch = change(project.patch)
      if (patch === project.patch) return project
      if (record) remember(project.patch)
      return { ...project, patch }
    })
  }

  function begin() {
    if (state.current && !gesture.current) gesture.current = active(state.current).patch
  }

  function end() {
    const before = gesture.current
    gesture.current = undefined
    if (before && state.current && before !== active(state.current).patch) {
      remember(before)
      refresh(value => value + 1)
    }
  }

  function step(direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? undo : redo
    const to = direction === 'undo' ? redo : undo
    const patch = from.current.pop()
    if (!patch) return
    updatePatch(current => {
      to.current.push(current)
      return patch
    }, false)
  }

  async function changeLibrary(change: (library: Library) => Library) {
    if (!state.current || changingLibrary.current) return false
    changingLibrary.current = true
    setError('')
    setBusy(true)
    window.clearTimeout(timer.current)
    const current = state.current
    try {
      await save(current)
      const next = change(current)
      await save(next)
      if (next.current !== current.current) {
        undo.current = []
        redo.current = []
        gesture.current = undefined
      }
      publish(next)
      setStatus('saved')
      return true
    } catch {
      setStatus('error')
      setError('Не удалось сохранить проект. Выгрузите его в JSON и повторите действие.')
      return false
    } finally {
      changingLibrary.current = false
      setBusy(false)
    }
  }

  return {
    library, project: library && active(library), status, error, setError, busy, engine,
    begin, end, step, canUndo: undo.current.length > 0, canRedo: redo.current.length > 0,
    updateProject, updatePatch, changeLibrary,
    currentPatch: () => state.current && active(state.current).patch,
  }
}
