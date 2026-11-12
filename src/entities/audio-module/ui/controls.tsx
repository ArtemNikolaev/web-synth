import { useRef, useState } from 'react'
import { numeric, type Module, type OscillatorLayer } from '../model/contract.ts'
import { gainRange, parameterRange } from '../model/catalog.ts'
import './controls.css'

export type ControlProps = {
  node: Module
  engine: {
    midiEnabled: boolean
    midiDevices: readonly { id: string; name?: string | null }[]
    enableMidi: () => Promise<void>
    warning: (id: string) => string | undefined
  }
  setParam: (key: string, value: string | number, transient?: boolean) => void
  changeOscillators: (change: (layers: OscillatorLayer[]) => OscillatorLayer[], transient?: boolean) => void
  begin: () => void
  end: () => void
  grow: () => void
}

export type Device = { id: string; name: string }

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

export function DeviceSelect({ label, value, defaultLabel, devices, onChange }: {
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

export function useSlider({ node, setParam, begin, end }: ControlProps) {
  const rangeGesture = useRef(false)
  function slider(key: string, label: string, unit = '', value = numeric(node, key),
    change = (next: number, transient?: boolean) => setParam(key, next, transient)) {
    const [min, max, step] = parameterRange(node.kind, key) ?? gainRange
    const finish = () => {
      if (!rangeGesture.current) return
      rangeGesture.current = false
      end()
    }
    return (
      <div className="range field" key={key}>
        <label className="range-value">
          {label}{unit && <span className="unit">, {unit.trim()}</span>}
          <NumberField label={label} unit={unit} value={value} min={min} max={max} step={step} change={change} />
        </label>
        <input type="range" aria-label={label + ' — ползунок'} min={min} max={max} step={step} value={value} onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId)
          rangeGesture.current = true
          begin()
        }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
          onChange={event => change(event.currentTarget.valueAsNumber, rangeGesture.current)} />
      </div>
    )
  }
  return slider
}

export function ControlWarning({ message, engine, node }: { message?: string } & Pick<ControlProps, 'engine' | 'node'>) {
  const warning = message || engine.warning(node.id)
  return warning ? <p className="help" role="status">{warning}</p> : null
}
