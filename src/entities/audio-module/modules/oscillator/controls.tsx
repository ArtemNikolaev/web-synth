import { gainRange } from '../../model/catalog.ts'
import { noteFrequency, waves } from '../../model/contract.ts'
import { oscillatorLayers, setWaveGain, waveGain } from './definition.ts'
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
  const layers = oscillatorLayers(node)
  return <>
    <fieldset className="oscillator-section">
      <legend>Частота</legend>
      <label className="field"><span>Нота</span>
        <select aria-label="Нота" value={oscillatorPresets.find(preset => preset.frequency === node.params.frequency)?.frequency ?? ''}
          onChange={event => setParam('frequency', Number(event.target.value))}>
          <option value="" disabled>Произвольная частота</option>
          {oscillatorPresets.map(preset => <option key={preset.name} value={preset.frequency}>{preset.name} · {preset.frequency} Гц</option>)}
        </select>
      </label>
      {slider('frequency', 'Частота', ' Гц')}
    </fieldset>
    <fieldset className="oscillator-section">
      <legend>Примесь волн</legend>
      {waves.map(wave => {
        const gain = waveGain(layers, wave)
        const [min, max, step] = gainRange
        return slider(wave, wave, '', Number(gain.toFixed(4)), (next, transient) =>
          changeOscillators(current => setWaveGain(current, wave, next), transient), [min, Math.max(max, gain), step])
      })}
    </fieldset>
    <fieldset className="oscillator-section">
      <legend>Выход</legend>
      {slider('outputGain', 'Общий gain')}
    </fieldset>
    <ControlWarning {...props} />
  </>
}
