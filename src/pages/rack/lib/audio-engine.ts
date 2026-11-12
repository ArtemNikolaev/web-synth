import {
  acceptsMidi, changedMidiInput, createModuleRuntime, numeric, ports, usesMidiDevice, type Module, type ModuleRuntime,
} from '../../../entities/audio-module/index.ts'
import { signalAt, type Patch, type Wire } from '../../../entities/project/index.ts'

type Runtime = {
  inputs: Map<string, GainNode>
  outputs: Map<string, GainNode>
  bus: GainNode
  module: ModuleRuntime
}

export class AudioEngine {
  private context?: AudioContext
  private patch?: Patch
  private master?: DynamicsCompressorNode
  private runtimes = new Map<string, Runtime>()
  private links = new Map<string, { source: GainNode; bridge: GainNode; target: GainNode }>()
  private midi?: MIDIAccess
  private midiInputs = new Set<MIDIInput>()
  private warnings = new Map<string, string>()

  constructor(private changed: () => void) {}

  get active() { return this.context?.state === 'running' }
  get midiEnabled() { return Boolean(this.midi) }
  get midiDevices() { return [...(this.midi?.inputs.values() ?? [])].filter(device => device.state === 'connected') }
  warning(id: string) { return this.warnings.get(id) }

  async start() {
    if (!this.context) {
      this.context = new AudioContext()
      this.context.onstatechange = this.changed
      this.master = this.context.createDynamicsCompressor()
      this.master.connect(this.context.destination)
      navigator.mediaDevices?.addEventListener('devicechange', this.refreshRoutes)
      if (this.patch) this.sync(this.patch)
    }
    await this.context.resume()
    this.changed()
  }

  async stop() {
    if (!this.context) return
    await this.context.suspend()
    for (const runtime of this.runtimes.values()) runtime.module.releaseAll?.()
    this.changed()
  }

  async enableMidi() {
    if (this.midi) return
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI недоступен. Откройте приложение через localhost или HTTPS.')
    this.midi = await navigator.requestMIDIAccess()
    this.midi.onstatechange = event => {
      if (event.port?.state === 'disconnected') {
        for (const node of this.patch?.modules ?? []) {
          if (usesMidiDevice(node, event.port.id)) this.releaseDestinations(node.id)
        }
      }
      this.bindMidi()
      this.changed()
    }
    this.bindMidi()
    this.changed()
  }

  private bindMidi() {
    for (const input of this.midiInputs) input.onmidimessage = null
    this.midiInputs = new Set(this.midiDevices)
    for (const input of this.midiInputs) input.onmidimessage = event => this.handleMidi(input.id, event.data)
  }

  private ramp(param: AudioParam, value: number) {
    param.setTargetAtTime(value, this.context!.currentTime, 0.008)
  }

  private makeRuntime(node: Module): Runtime {
    const ctx = this.context!
    const bus = ctx.createGain()
    const module = createModuleRuntime(node.kind, {
      context: ctx,
      master: this.master!,
      ramp: (param, value) => this.ramp(param, value),
      setWarning: message => {
        if (message) this.warnings.set(node.id, message)
        else this.warnings.delete(node.id)
      },
      hasWarning: () => this.warnings.has(node.id),
      changed: this.changed,
    }, bus)
    bus.gain.value = module.fixedBusGain ?? numeric(node, 'gain')
    return { inputs: new Map(), outputs: new Map(), bus, module }
  }

  private apply(node: Module, runtime: Runtime) {
    const ctx = this.context!
    if (runtime.module.fixedBusGain === undefined) this.ramp(runtime.bus.gain, numeric(node, 'gain'))
    for (const side of ['in', 'out'] as const) {
      const terminals = side === 'in' ? runtime.inputs : runtime.outputs
      const audioPorts = ports(node, side).filter(port => port.signal === 'audio')
      for (const [id, terminal] of terminals) {
        if (audioPorts.some(port => port.id === id)) continue
        if (side === 'out') runtime.bus.disconnect(terminal)
        terminal.disconnect()
        terminals.delete(id)
      }
      for (const port of audioPorts) {
        let terminal = terminals.get(port.id)
        const gain = numeric(node, port.id)
        if (!terminal) {
          terminal = ctx.createGain()
          terminal.gain.value = gain
          terminals.set(port.id, terminal)
          if (side === 'in') terminal.connect(runtime.bus)
          else runtime.bus.connect(terminal)
        } else this.ramp(terminal.gain, gain)
      }
    }
    runtime.module.apply?.(node)
  }

  private refreshRoutes = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const available = new Set(devices.filter(device => device.kind === 'audiooutput').map(device => device.deviceId))
      for (const node of this.patch?.modules ?? []) {
        this.runtimes.get(node.id)?.module.refreshRoute?.(node, available)
      }
    } catch {
      // Keep the last route if the browser can't enumerate devices.
    }
  }

  sync(next: Patch) {
    const previous = this.patch
    this.patch = next
    if (!this.context) return

    if (previous) {
      for (const edge of previous.wires) {
        const source = previous.modules.find(node => node.id === edge.source)
        if (!source || signalAt(source, 'out', edge.sourceHandle) !== 'midi') continue
        const current = next.modules.find(node => node.id === edge.source)
        if (!next.wires.some(wire => sameWire(wire, edge)) || changedMidiInput(source, current)) {
          this.releaseAll(edge.target)
        }
      }
    }

    const nodes = new Map(next.modules.map(node => [node.id, node]))
    const wires = new Map(next.wires.map(wire => [wire.id, wire]))
    for (const [id, link] of this.links) {
      const edge = wires.get(id)
      if (edge && this.runtimes.get(edge.source)?.outputs.get(edge.sourceHandle) === link.source &&
        this.runtimes.get(edge.target)?.inputs.get(edge.targetHandle) === link.target &&
        signalAt(nodes.get(edge.source), 'out', edge.sourceHandle) === 'audio' &&
        signalAt(nodes.get(edge.target), 'in', edge.targetHandle) === 'audio') continue
      this.links.delete(id)
      this.ramp(link.bridge.gain, 0)
      setTimeout(() => {
        try { link.source.disconnect(link.bridge) } catch { /* The source was already disposed. */ }
        link.bridge.disconnect()
      }, 50)
    }

    for (const [id, runtime] of this.runtimes) {
      if (nodes.has(id)) continue
      this.runtimes.delete(id)
      this.warnings.delete(id)
      runtime.module.deactivate?.()
      this.ramp(runtime.bus.gain, 0)
      setTimeout(() => {
        runtime.module.dispose?.()
        runtime.bus.disconnect()
        for (const input of runtime.inputs.values()) input.disconnect()
      }, 50)
    }

    for (const node of next.modules) {
      const existing = this.runtimes.get(node.id)
      const runtime = existing ?? this.makeRuntime(node)
      this.runtimes.set(node.id, runtime)
      const before = previous?.modules.find(item => item.id === node.id)
      if (!existing || before?.params !== node.params || before.oscillators !== node.oscillators || before.count !== node.count) this.apply(node, runtime)
    }

    for (const edge of next.wires) {
      if (this.links.has(edge.id)) continue
      const source = this.runtimes.get(edge.source)?.outputs.get(edge.sourceHandle)
      const target = this.runtimes.get(edge.target)?.inputs.get(edge.targetHandle)
      if (!source || !target) continue
      const bridge = this.context.createGain()
      bridge.gain.value = 0
      source.connect(bridge)
      bridge.connect(target)
      this.ramp(bridge.gain, 1)
      this.links.set(edge.id, { source, bridge, target })
    }
  }

  private releaseDestinations(source: string) {
    for (const wire of this.patch?.wires ?? []) if (wire.source === source) this.releaseAll(wire.target)
  }

  private releaseAll(id: string) {
    this.runtimes.get(id)?.module.releaseAll?.()
  }

  private handleMidi(device: string, bytes: Uint8Array | null) {
    if (!bytes || !this.patch || !this.active) return
    const [status, note, velocity] = bytes
    const command = status & 0xf0
    const channel = (status & 15) + 1
    if (command !== 0x80 && command !== 0x90 && !(command === 0xb0 && (note === 120 || note === 123))) return

    for (const input of this.patch.modules) {
      if (!acceptsMidi(input, device, channel)) continue
      for (const wire of this.patch.wires) {
        if (wire.source !== input.id) continue
        const synth = this.patch.modules.find(node => node.id === wire.target)
        const runtime = this.runtimes.get(wire.target)
        if (synth) runtime?.module.onMidi?.(synth, { command, note, channel, velocity })
      }
    }
  }

}

const sameWire = (a: Wire, b: Wire) => a.id === b.id && a.source === b.source && a.target === b.target && a.sourceHandle === b.sourceHandle && a.targetHandle === b.targetHandle
