import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Handle, Position, useConnection, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react'
import { supportsOutputSelection, type AudioEngine } from './audio.ts'
import { modules, noteFrequency, numeric, ports, waves, type Module, type WindowState } from './model.ts'
import { ranges } from './storage.ts'

export type RackNode = Node<{ module: Module }, 'rack'>
export const nodeTypes = { rack: RackModule }

const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const oscillatorPresets = Array.from({ length: 24 }, (_, index) => ({
  name: noteNames[index % 12] + (2 + Math.floor(index / 12)),
  frequency: Number(noteFrequency(36 + index).toFixed(2)),
}))

function describe(node: Module) {
  switch (node.kind) {
    case 'osc': return node.params.wave + ' · ' + node.params.frequency + ' Hz'
    case 'midi': return node.params.channel ? 'Канал ' + node.params.channel : 'Все каналы'
    case 'synth': return 'Полифония · ' + node.params.voices
    case 'mix': return node.count + ' входа · Gain ' + node.params.gain
    case 'split': return node.count + ' выхода · Gain ' + node.params.gain
    case 'out': return node.params.device ? 'Выбранное устройство' : 'Системный выход'
  }
}

function RackModule({ id, data, selected }: NodeProps<RackNode>) {
  const node = data.module
  const update = useUpdateNodeInternals()
  useLayoutEffect(() => update(id), [id, node.count, update])
  const start = useConnection(connection => connection.inProgress ? connection.fromHandle : null)
  const startNode = useConnection(connection => connection.inProgress ? connection.fromNode?.data.module as Module | undefined : undefined)
  const startPorts = startNode && start ? ports(startNode, start.type === 'source' ? 'out' : 'in') : []
  const startSignal = startPorts.find(port => port.id === start?.id)?.signal
  const inputs = ports(node, 'in')
  const outputs = ports(node, 'out')
  const maxPorts = Math.max(inputs.length, outputs.length)
  return (
    <article className={'rack-node kind-' + node.kind + (selected ? ' selected' : '')} style={{ minHeight: Math.max(86, 55 + maxPorts * 24) }}>
      <strong>{modules[node.kind].title}{node.auto && <span className="auto">auto</span>}</strong>
      <div className="node-summary">{describe(node)}</div>
      {(['in', 'out'] as const).flatMap(side => {
        const list = side === 'in' ? inputs : outputs
        const type = side === 'in' ? 'target' : 'source'
        return list.map(port => {
          const offset = maxPorts === 1 ? '50%' : 62 + port.index * 24
          const compatible = start && start.type !== type && start.nodeId !== id && startSignal === port.signal
          return (
            <Handle key={port.id} id={port.id} type={type} position={side === 'in' ? Position.Left : Position.Right}
              className={'port ' + port.signal + (start ? (compatible ? ' compatible' : ' dim') : '')}
              style={{ top: offset }} isConnectableStart={side === 'out'} isConnectableEnd={!start || Boolean(compatible)}
              title={(side === 'in' ? 'Вход ' : 'Выход ') + (port.index + 1) + ' · ' + port.signal}
              aria-label={(side === 'in' ? 'Вход ' : 'Выход ') + (port.index + 1) + ' · ' + port.signal}>
              <span className="port-number">{port.index + 1}</span>
            </Handle>
          )
        })
      })}
    </article>
  )
}

type Device = { id: string; name: string }

function NumberField({ label, unit, value, min, max, step, change }: {
  label: string; unit: string; value: number; min: number; max: number; step: number; change: (value: number) => void
}) {
  const [draft, setDraft] = useState<string>()
  return <input type="number" aria-label={label + unit} min={min} max={max} step={step} value={draft ?? value}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={event => {
      const entered = event.currentTarget.valueAsNumber
      setDraft(undefined)
      if (draft === undefined || !Number.isFinite(entered)) return
      const bounded = Math.max(min, Math.min(max, entered))
      const precision = String(step).split('.')[1]?.length ?? 0
      const normalized = Number((min + Math.round((bounded - min) / step) * step).toFixed(precision))
      if (normalized !== value) change(normalized)
    }}
    onKeyDown={event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
      }
      if (event.key === 'Escape') {
        event.stopPropagation()
        setDraft(undefined)
      }
    }} />
}

function DeviceSelect({ label, value, defaultLabel, devices, onChange }: {
  label: string; value: string; defaultLabel: string; devices: Device[]; onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{defaultLabel}</option>
        {value && !devices.some(device => device.id === value) && <option value={value}>Недоступное устройство</option>}
        {devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
      </select>
    </label>
  )
}

export function WidgetControls({ node, engine, setParam, begin, end, grow }: {
  node: Module; engine: AudioEngine; setParam: (key: string, value: string | number, transient?: boolean) => void
  begin: () => void; end: () => void; grow: () => void
}) {
  const [outputs, setOutputs] = useState<Device[]>([])
  const [outputAccess, setOutputAccess] = useState<'idle' | 'requesting' | 'granted'>('idle')
  const [message, setMessage] = useState('')
  const midiReady = engine.midiEnabled
  const rangeGesture = useRef(false)

  async function refreshOutputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setOutputs(devices.filter(device => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default')
        .map((device, index) => ({ id: device.deviceId, name: device.label || 'Аудиовыход ' + (index + 1) })))
      setMessage('')
    } catch {
      setMessage('Не удалось получить список аудиоустройств.')
    }
  }

  async function revealOutputs() {
    setOutputAccess('requesting')
    setMessage('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      setOutputAccess('granted')
      await refreshOutputs()
    } catch (error) {
      setOutputAccess('idle')
      const denied = error instanceof DOMException && error.name === 'NotAllowedError'
      setMessage(denied
        ? 'Chrome не дал доступ к микрофону. Разрешение можно изменить в настройках сайта.'
        : 'Chrome не смог открыть микрофон для получения списка выходов.')
    }
  }

  useEffect(() => {
    if (node.kind !== 'out' || !navigator.mediaDevices || !supportsOutputSelection()) return
    const refresh = () => { void refreshOutputs() }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [node.kind])

  async function midi() {
    try {
      await engine.enableMidi()
      setMessage('')
    } catch (error) {
      setMessage(error instanceof DOMException ? 'Доступ к MIDI не получен.' : String((error as Error).message))
    }
  }

  function slider(key: string, label: string, unit = '') {
    const [min, max, step] = ranges[key] ?? ranges.gain
    const value = numeric(node, key)
    const finish = () => {
      if (!rangeGesture.current) return
      rangeGesture.current = false
      end()
    }
    return (
      <div className="range field" key={key}>
        <label className="range-value">
          {label}{unit && <span className="unit">, {unit.trim()}</span>}
          <NumberField label={label} unit={unit} value={value} min={min} max={max} step={step} change={next => setParam(key, next)} />
        </label>
        <input type="range" aria-label={label + ' — ползунок'} min={min} max={max} step={step} value={value} onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          rangeGesture.current = true
          begin()
        }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
          onChange={event => setParam(key, event.currentTarget.valueAsNumber, rangeGesture.current)} />
      </div>
    )
  }

  return <>
    {(node.kind === 'osc' || node.kind === 'synth') && (
      <label className="field"><span>Форма волны</span><select value={node.params.wave} onChange={event => setParam('wave', event.target.value)}>
        {waves.map(wave => <option key={wave}>{wave}</option>)}
      </select></label>
    )}
    {node.kind === 'osc' && <>
      <label className="field"><span>Нота</span>
        <select aria-label="Нота" value={oscillatorPresets.find(preset => preset.frequency === node.params.frequency)?.frequency ?? ''}
          onChange={event => setParam('frequency', Number(event.target.value))}>
          <option value="" disabled>Произвольная частота</option>
          {oscillatorPresets.map(preset => <option key={preset.name} value={preset.frequency}>{preset.name} · {preset.frequency} Гц</option>)}
        </select>
      </label>
      {slider('frequency', 'Частота', ' Гц')}
    </>}
    {node.kind === 'synth' && <>
      {slider('voices', 'Голосов')}
      {slider('attack', 'Атака', ' с')}
      {slider('release', 'Затухание', ' с')}
    </>}
    {node.kind === 'midi' ? <>
      {!midiReady && <button onClick={midi}>Разрешить MIDI</button>}
      <DeviceSelect label="MIDI-устройство" value={String(node.params.device)} defaultLabel="Выберите устройство"
        devices={engine.midiDevices.map(device => ({ id: device.id, name: device.name || device.id }))} onChange={value => setParam('device', value)} />
      {midiReady && engine.midiDevices.length === 0 && <p className="help">Подключите MIDI-контроллер или виртуальный MIDI-порт.</p>}
      <label className="field"><span>Канал</span><select value={node.params.channel} onChange={event => setParam('channel', Number(event.target.value))}>
        <option value={0}>Все каналы</option>
        {Array.from({ length: 16 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
      </select></label>
    </> : slider('gain', node.kind === 'split' ? 'Входной gain' : 'Gain')}
    {node.kind === 'out' && <>
      <DeviceSelect label="Аудиоустройство" value={String(node.params.device)} defaultLabel="Системный выход" devices={outputs}
        onChange={value => setParam('device', value)} />
      {(!supportsOutputSelection() || !navigator.mediaDevices) && <p className="help">Доступен системный выход. Выбор устройства браузером не поддерживается.</p>}
      {supportsOutputSelection() && navigator.mediaDevices && <>
        {outputAccess !== 'granted' && <>
          <p className="help">Для полного списка выходов Chrome может запросить доступ к микрофону. Приложение сразу отключит микрофон после получения разрешения.</p>
          <button onClick={revealOutputs} disabled={outputAccess === 'requesting'}>Показать другие выходы</button>
        </>}
        {outputAccess === 'granted' && !outputs.length && <p className="help">Chrome показывает только системный выход.</p>}
        <button onClick={refreshOutputs}>Обновить список устройств</button>
      </>}
    </>}
    {(node.kind === 'mix' || node.kind === 'split') && <>
      {ports(node, node.kind === 'mix' ? 'in' : 'out').map(port => slider(port.id, (node.kind === 'mix' ? 'Вход ' : 'Выход ') + (port.index + 1)))}
      <button onClick={grow}>{node.kind === 'mix' ? 'Добавить вход' : 'Добавить выход'}</button>
    </>}
    {(message || engine.warning(node.id)) && <p className="help" role="status">{message || engine.warning(node.id)}</p>}
  </>
}

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
