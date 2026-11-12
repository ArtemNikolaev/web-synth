import './styles.css'
import { ports } from '../../model/catalog.ts'
import { useSlider, ControlWarning, type ControlProps } from '../../ui/controls.tsx'

export function MixerControls(props: ControlProps) {
  const { node, grow } = props
  const slider = useSlider(props)
  return <>
    {slider('gain', 'Gain')}
    {ports(node, 'in').map(port => slider(port.id, 'Вход ' + (port.index + 1)))}
    <button onClick={grow}>Добавить вход</button>
    <ControlWarning {...props} />
  </>
}
