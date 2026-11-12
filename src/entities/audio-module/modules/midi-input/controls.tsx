import './styles.css'
import { useState } from 'react'
import { DeviceSelect, ControlWarning, type ControlProps } from '../../ui/controls.tsx'

export function MidiInputControls(props: ControlProps) {
  const { node, engine, setParam } = props
  const [message, setMessage] = useState('')
  const midiReady = engine.midiEnabled

  async function midi() {
    try {
      await engine.enableMidi()
      setMessage('')
    } catch (error) {
      setMessage(error instanceof DOMException ? 'Доступ к MIDI не получен.' : String((error as Error).message))
    }
  }

  return <>
    {!midiReady && <button onClick={midi}>Разрешить MIDI</button>}
    <DeviceSelect label="MIDI-устройство" value={String(node.params.device)} defaultLabel="Выберите устройство"
      devices={engine.midiDevices.map(device => ({ id: device.id, name: device.name || device.id }))} onChange={value => setParam('device', value)} />
    {midiReady && engine.midiDevices.length === 0 && <p className="help">Подключите MIDI-контроллер или виртуальный MIDI-порт.</p>}
    <label className="field"><span>Канал</span><select value={node.params.channel} onChange={event => setParam('channel', Number(event.target.value))}>
      <option value={0}>Все каналы</option>
      {Array.from({ length: 16 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
    </select></label>
    <ControlWarning {...props} message={message} />
  </>
}
