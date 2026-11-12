import { noteFrequency, waves, type OscillatorLayer } from '../../model/contract.ts'
import { createOscillatorLayer, oscillatorLayers } from './definition.ts'
import './styles.css'
import { useSlider, ControlWarning, type ControlProps } from '../../ui/controls.tsx'
const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const oscillatorPresets = Array.from({ length: 24 }, (_, index) => ({
  name: noteNames[index % 12] + (2 + Math.floor(index / 12)),
  frequency: Number(noteFrequency(36 + index).toFixed(2)),
}))


export function OscillatorControls(props: ControlProps) {
  const { node, setParam, changeOscillators } = props
  const slider = useSlider(props)
  return <>
    <label className="field"><span>Нота</span>
      <select aria-label="Нота" value={oscillatorPresets.find(preset => preset.frequency === node.params.frequency)?.frequency ?? ''}
        onChange={event => setParam('frequency', Number(event.target.value))}>
        <option value="" disabled>Произвольная частота</option>
        {oscillatorPresets.map(preset => <option key={preset.name} value={preset.frequency}>{preset.name} · {preset.frequency} Гц</option>)}
      </select>
    </label>
    {slider('frequency', 'Частота', ' Гц')}
    {oscillatorLayers(node).map((layer, index, layers) => {
      const title = 'Генератор ' + (index + 1)
      const update = (values: Partial<OscillatorLayer>, transient?: boolean) =>
        changeOscillators(current => current.map(item => item.id === layer.id ? { ...item, ...values } : item), transient)
      return <fieldset className="oscillator-layer" key={layer.id}>
        <legend>{title}</legend>
        <div className="oscillator-actions">
          <label><input type="checkbox" checked={layer.enabled} onChange={event => update({ enabled: event.target.checked })} /> Активен</label>
          {layers.length > 1 && <button aria-label={'Удалить генератор ' + (index + 1)}
            onClick={() => changeOscillators(current => current.filter(item => item.id !== layer.id))}>Удалить</button>}
        </div>
        <label className="field"><span>Форма волны</span>
          <select value={layer.wave} onChange={event => update({ wave: event.target.value as OscillatorLayer['wave'] })}>
            {waves.map(wave => <option key={wave}>{wave}</option>)}
          </select>
        </label>
        {slider('gain', 'Gain', '', layer.gain, (gain, transient) => update({ gain }, transient))}
      </fieldset>
    })}
    <button onClick={() => changeOscillators(layers => [...layers, createOscillatorLayer(crypto.randomUUID())])}>
      Добавить генератор
    </button>
    <ControlWarning {...props} />
  </>
}
