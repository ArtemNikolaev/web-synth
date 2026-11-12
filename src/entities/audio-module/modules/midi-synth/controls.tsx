import { waves } from '../../model/contract.ts'
import { useSlider, ControlWarning, type ControlProps } from '../../ui/controls.tsx'

export function MidiSynthControls(props: ControlProps) {
  const { node, setParam } = props
  const slider = useSlider(props)
  return <>
    <label className="field"><span>Форма волны</span><select value={node.params.wave} onChange={event => setParam('wave', event.target.value)}>
      {waves.map(wave => <option key={wave}>{wave}</option>)}
    </select></label>
    {slider('voices', 'Голосов')}
    {slider('attack', 'Атака', ' с')}
    {slider('release', 'Затухание', ' с')}
    {slider('gain', 'Gain')}
    <ControlWarning {...props} />
  </>
}
