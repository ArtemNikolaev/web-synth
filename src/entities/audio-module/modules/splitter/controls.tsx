import './styles.css'
import { ports } from '../../model/catalog.ts'
import { useSlider, ControlWarning, type ControlProps } from '../../ui/controls.tsx'

export function SplitterControls(props: ControlProps) {
  const { node, grow } = props
  const slider = useSlider(props)
  return <>
    {slider('gain', 'Входной gain')}
    {ports(node, 'out').map(port => slider(port.id, 'Выход ' + (port.index + 1)))}
    <button onClick={grow}>Добавить выход</button>
    <ControlWarning {...props} />
  </>
}
