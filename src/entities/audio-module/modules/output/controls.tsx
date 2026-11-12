import './styles.css'
import { useEffect, useState } from 'react'
import { supportsOutputSelection } from './runtime.ts'
import { DeviceSelect, ControlWarning, useSlider, type Device, type ControlProps } from '../../ui/controls.tsx'

export function OutputControls(props: ControlProps) {
  const { node, setParam } = props
  const slider = useSlider(props)
  const [outputs, setOutputs] = useState<Device[]>([])
  const [outputAccess, setOutputAccess] = useState<'idle' | 'requesting' | 'granted'>('idle')
  const [message, setMessage] = useState('')

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
    if (!navigator.mediaDevices || !supportsOutputSelection()) return
    const refresh = () => { void refreshOutputs() }
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh)
  }, [])

  return <>
    {slider('gain', 'Gain')}
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
    <ControlWarning {...props} message={message} />
  </>
}
