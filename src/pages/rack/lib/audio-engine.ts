import { noteFrequency, numeric, oscillatorLayers, ports, signalAt, type Module, type Patch, type Wire } from '../../../entities/project/index.ts'

type SinkElement = HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
type Voice = { note: number; channel: number; oscillator: OscillatorNode; level: GainNode; start: number; attack: number; peak: number; released: boolean }
type Generator = { oscillator: OscillatorNode; level: GainNode }
type Runtime = {
  inputs: Map<string, GainNode>
  outputs: Map<string, GainNode>
  bus: GainNode
  oscillators?: Map<string, Generator>
  voices: Set<Voice>
  defaultRoute?: GainNode
  stream?: MediaStreamAudioDestinationNode
  element?: SinkElement
  device?: string
  request?: object
}

export const supportsOutputSelection = () => 'setSinkId' in HTMLMediaElement.prototype

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

  async enableMidi() {
    if (this.midi) return
    if (!navigator.requestMIDIAccess) throw new Error('Web MIDI недоступен. Откройте приложение через localhost или HTTPS.')
    this.midi = await navigator.requestMIDIAccess()
    this.midi.onstatechange = event => {
      if (event.port?.state === 'disconnected') {
        for (const node of this.patch?.modules ?? []) {
          if (node.kind === 'midi' && node.params.device === event.port.id) this.releaseDestinations(node.id)
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
    const runtime: Runtime = { inputs: new Map(), outputs: new Map(), bus: ctx.createGain(), voices: new Set() }
    runtime.bus.gain.value = node.kind === 'osc' ? 1 : numeric(node, 'gain')
    if (node.kind === 'osc') runtime.oscillators = new Map()
    if (node.kind === 'out') {
      runtime.defaultRoute = ctx.createGain()
      runtime.bus.connect(runtime.defaultRoute)
      runtime.defaultRoute.connect(this.master!)
    }
    return runtime
  }

  private apply(node: Module, runtime: Runtime) {
    const ctx = this.context!
    if (runtime.oscillators) this.applyOscillators(node, runtime, runtime.oscillators)
    else this.ramp(runtime.bus.gain, numeric(node, 'gain'))
    if (node.kind === 'synth') {
      const held = [...runtime.voices].filter(voice => !voice.released)
      for (const voice of held.slice(0, Math.max(0, held.length - numeric(node, 'voices')))) this.release(voice, 0.025)
    }

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

    if (node.kind === 'out' && runtime.device !== node.params.device) this.routeOutput(node, runtime)
  }

  private applyOscillators(node: Module, runtime: Runtime, generators: Map<string, Generator>) {
    const ctx = this.context!
    const active = oscillatorLayers(node).filter(layer => layer.enabled)
    const ids = new Set(active.map(layer => layer.id))
    for (const [id, generator] of generators) {
      if (ids.has(id)) continue
      this.ramp(generator.level.gain, 0)
      generator.oscillator.stop(ctx.currentTime + 0.05)
      generators.delete(id)
    }

    const frequency = numeric(node, 'frequency')
    for (const layer of active) {
      let generator = generators.get(layer.id)
      if (!generator) {
        const oscillator = ctx.createOscillator()
        const level = ctx.createGain()
        oscillator.frequency.value = frequency
        oscillator.type = layer.wave
        level.gain.value = 0
        oscillator.connect(level)
        level.connect(runtime.bus)
        oscillator.onended = () => {
          oscillator.disconnect()
          level.disconnect()
        }
        oscillator.start()
        generator = { oscillator, level }
        generators.set(layer.id, generator)
      }
      generator.oscillator.type = layer.wave
      this.ramp(generator.oscillator.frequency, frequency)
      this.ramp(generator.level.gain, layer.gain)
    }
  }

  private routeOutput(node: Module, runtime: Runtime) {
    const device = String(node.params.device)
    runtime.device = device
    const request = {}
    runtime.request = request
    this.ramp(runtime.defaultRoute!.gain, 1)
    this.disposeOutput(runtime)
    this.warnings.delete(node.id)
    if (!device) return
    if (!supportsOutputSelection()) {
      this.warnings.set(node.id, 'Выбор устройства вывода недоступен')
      return
    }
    const ctx = this.context!
    runtime.stream = ctx.createMediaStreamDestination()
    runtime.bus.connect(runtime.stream)
    const element: SinkElement = new Audio()
    runtime.element = element
    element.srcObject = runtime.stream.stream
    void element.setSinkId!(device).then(async () => {
      if (runtime.request !== request) return
      await element.play()
      if (runtime.request !== request) return
      this.ramp(runtime.defaultRoute!.gain, 0)
      this.changed()
    }).catch(() => {
      if (runtime.request !== request) return
      this.disposeOutput(runtime)
      this.warnings.set(node.id, 'Устройство недоступно. Используется системный выход.')
      this.changed()
    })
  }

  private disposeOutput(runtime: Runtime) {
    if (runtime.element) {
      runtime.element.pause()
      runtime.element.srcObject = null
      runtime.element = undefined
    }
    if (runtime.stream) {
      runtime.bus.disconnect(runtime.stream)
      runtime.stream.stream.getTracks().forEach(track => track.stop())
      runtime.stream = undefined
    }
  }

  private refreshRoutes = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const available = new Set(devices.filter(device => device.kind === 'audiooutput').map(device => device.deviceId))
      for (const node of this.patch?.modules ?? []) {
        if (node.kind !== 'out' || !node.params.device) continue
        const runtime = this.runtimes.get(node.id)
        if (!runtime) continue
        if (available.has(String(node.params.device)) === this.warnings.has(node.id)) this.routeOutput(node, runtime)
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
        if (source?.kind !== 'midi') continue
        const current = next.modules.find(node => node.id === edge.source)
        if (!next.wires.some(wire => sameWire(wire, edge)) || current?.params.device !== source.params.device || current.params.channel !== source.params.channel) {
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
      runtime.request = undefined
      this.ramp(runtime.bus.gain, 0)
      setTimeout(() => {
        for (const generator of runtime.oscillators?.values() ?? []) generator.oscillator.stop()
        for (const voice of runtime.voices) voice.oscillator.stop()
        this.disposeOutput(runtime)
        runtime.bus.disconnect()
        runtime.defaultRoute?.disconnect()
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
    for (const voice of this.runtimes.get(id)?.voices ?? []) this.release(voice, 0.04)
  }

  private release(voice: Voice, seconds: number) {
    if (voice.released) return
    const now = this.context!.currentTime
    voice.released = true
    const gain = voice.level.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(voice.peak * Math.min(1, Math.max(0, now - voice.start) / voice.attack), now)
    gain.setTargetAtTime(0, now, seconds / 5)
    voice.oscillator.stop(now + seconds + 0.015)
  }

  private handleMidi(device: string, bytes: Uint8Array | null) {
    if (!bytes || !this.patch || !this.active) return
    const [status, note, velocity] = bytes
    const command = status & 0xf0
    const channel = (status & 15) + 1
    if (command !== 0x80 && command !== 0x90 && !(command === 0xb0 && (note === 120 || note === 123))) return

    for (const input of this.patch.modules) {
      if (input.kind !== 'midi' || input.params.device !== device || (input.params.channel !== 0 && input.params.channel !== channel)) continue
      for (const wire of this.patch.wires) {
        if (wire.source !== input.id) continue
        const synth = this.patch.modules.find(node => node.id === wire.target)
        const runtime = this.runtimes.get(wire.target)
        if (!synth || !runtime) continue
        if (command === 0xb0) {
          for (const voice of runtime.voices) if (voice.channel === channel) this.release(voice, 0.04)
        } else if (command === 0x90 && velocity > 0) {
          this.noteOn(synth, runtime, note, channel, velocity)
        } else {
          const voice = [...runtime.voices].find(voice => !voice.released && voice.note === note && voice.channel === channel)
          if (voice) this.release(voice, numeric(synth, 'release'))
        }
      }
    }
  }

  private noteOn(node: Module, runtime: Runtime, note: number, channel: number, velocity: number) {
    const held = [...runtime.voices].filter(voice => !voice.released)
    if (held.length >= numeric(node, 'voices')) this.release(held[0], 0.025)
    const ctx = this.context!
    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const level = ctx.createGain()
    oscillator.type = node.params.wave as OscillatorType
    oscillator.frequency.value = noteFrequency(note)
    oscillator.connect(level)
    level.connect(runtime.bus)
    const peak = velocity / 127 / Math.sqrt(numeric(node, 'voices'))
    level.gain.setValueAtTime(0, now)
    level.gain.linearRampToValueAtTime(peak, now + numeric(node, 'attack'))
    const voice = { note, channel, oscillator, level, start: now, attack: numeric(node, 'attack'), peak, released: false }
    runtime.voices.add(voice)
    oscillator.onended = () => {
      oscillator.disconnect()
      level.disconnect()
      runtime.voices.delete(voice)
    }
    oscillator.start(now)
  }
}

const sameWire = (a: Wire, b: Wire) => a.id === b.id && a.source === b.source && a.target === b.target && a.sourceHandle === b.sourceHandle && a.targetHandle === b.targetHandle
