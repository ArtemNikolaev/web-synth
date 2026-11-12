import { useEffect, useState, type PointerEvent, type ReactNode } from 'react'
import type { WindowState } from '../../../entities/project/index.ts'

export function FloatingWindow({ title, win, z, focus, change, close, children }: {
  title: string; win: WindowState; z: number; focus: () => void; change: (win: WindowState) => void; close: () => void; children: ReactNode
}) {
  const [preview, setPreview] = useState<WindowState>()
  const displayed = preview ?? win
  const [bounds, setBounds] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const resize = () => setBounds({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const width = Math.min(displayed.width, bounds.width - 16)
  const height = displayed.minimized ? 46 : Math.min(displayed.height, bounds.height - 100)
  const x = Math.max(8, Math.min(displayed.x, bounds.width - width - 8))
  const y = Math.max(64, Math.min(displayed.y, bounds.height - height - 32))

  function drag(event: PointerEvent<HTMLElement>, resize: boolean) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    const target = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    target.setPointerCapture(event.pointerId)
    let next = { ...win, x, y }
    const move = (pointer: globalThis.PointerEvent) => {
      if (pointer.pointerId !== event.pointerId) return
      const dx = pointer.clientX - startX
      const dy = pointer.clientY - startY
      next = resize ? { ...win, x, y, width: Math.max(260, width + dx), height: Math.max(180, height + dy) }
        : { ...win, x: x + dx, y: y + dy }
      setPreview(next)
    }
    const stop = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('lostpointercapture', stop)
      setPreview(undefined)
      change(next)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('lostpointercapture', stop, { once: true })
  }

  return <section className="floating" aria-label={title} style={{ left: x, top: y, width, height, zIndex: z }} onPointerDown={focus}>
    <header onPointerDown={event => drag(event, false)}>
      <strong>{title}</strong>
      <button aria-label={win.minimized ? 'Развернуть' : 'Свернуть'} onClick={() => change({ ...win, minimized: !win.minimized })}>{win.minimized ? '+' : '−'}</button>
      <button aria-label="Закрыть окно" onClick={close}>×</button>
    </header>
    {!win.minimized && <><div className="window-body">{children}</div><span className="resize-grip" onPointerDown={event => drag(event, true)} /></>}
  </section>
}
