import type { Module } from '../../model/contract.ts'
import type { CreateModuleRuntime } from '../../lib/runtime-contract.ts'

type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }

export const supportsOutputSelection = () => 'setSinkId' in HTMLMediaElement.prototype

export const createOutput: CreateModuleRuntime = ({ context: ctx, master, ramp, setWarning, hasWarning, changed }, bus) => {
  const defaultRoute = ctx.createGain()
  bus.connect(defaultRoute)
  defaultRoute.connect(master)

  let device: string | undefined
  let currentRequest: object | undefined
  let stream: MediaStreamAudioDestinationNode | undefined
  let element: SinkElement | undefined

  function routeOutput(node: Module) {
    device = String(node.params.device)
    const request = {}
    currentRequest = request
    ramp(defaultRoute.gain, 1)
    disposeOutput()
    setWarning()
    if (!device) return
    if (!supportsOutputSelection()) {
      setWarning('Выбор устройства вывода недоступен')
      return
    }
    stream = ctx.createMediaStreamDestination()
    bus.connect(stream)
    const sink: SinkElement = new Audio()
    element = sink
    sink.srcObject = stream.stream
    void sink.setSinkId!(device).then(async () => {
      if (currentRequest !== request) return
      await sink.play()
      if (currentRequest !== request) return
      ramp(defaultRoute.gain, 0)
      changed()
    }).catch(() => {
      if (currentRequest !== request) return
      disposeOutput()
      setWarning('Устройство недоступно. Используется системный выход.')
      changed()
    })
  }

  function disposeOutput() {
    if (element) {
      element.pause()
      element.srcObject = null
      element = undefined
    }
    if (stream) {
      bus.disconnect(stream)
      stream.stream.getTracks().forEach(track => track.stop())
      stream = undefined
    }
  }

  return {
    apply(node) { if (device !== node.params.device) routeOutput(node) },
    refreshRoute(node, available) {
      if (node.params.device && available.has(String(node.params.device)) === hasWarning()) routeOutput(node)
    },
    deactivate() { currentRequest = undefined },
    dispose() {
      disposeOutput()
      defaultRoute.disconnect()
    },
  }
}
