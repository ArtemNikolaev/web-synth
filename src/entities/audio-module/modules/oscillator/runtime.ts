import { numeric, waves, type Module } from '../../model/contract.ts'
import { oscillatorLayers } from './definition.ts'
import type { CreateModuleRuntime } from '../../lib/runtime-contract.ts'

type Generator = { oscillator: OscillatorNode; level: GainNode }

export const createOscillator: CreateModuleRuntime = ({ context: ctx, ramp }, bus) => {
  const generators = new Map<string, Generator>()
  let initialized = false

  function apply(node: Module) {
    const outputGain = numeric(node, 'outputGain')
    if (initialized) ramp(bus.gain, outputGain)
    else {
      bus.gain.value = outputGain
      initialized = true
    }
    const active = oscillatorLayers(node).filter(layer => layer.enabled)
      .map(layer => ({ ...layer, id: 'layer:' + layer.id }))
    const present = new Set(active.map(layer => layer.wave))
    for (const wave of waves) {
      if (!present.has(wave)) active.push({ id: 'silent:' + wave, wave, gain: 0, enabled: true })
    }
    const ids = new Set(active.map(layer => layer.id))
    for (const [id, generator] of generators) {
      if (ids.has(id)) continue
      ramp(generator.level.gain, 0)
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
        level.connect(bus)
        oscillator.onended = () => {
          oscillator.disconnect()
          level.disconnect()
        }
        oscillator.start()
        generator = { oscillator, level }
        generators.set(layer.id, generator)
      }
      generator.oscillator.type = layer.wave
      ramp(generator.oscillator.frequency, frequency)
      ramp(generator.level.gain, layer.gain)
    }
  }

  return {
    fixedBusGain: 1,
    apply,
    dispose() { for (const generator of generators.values()) generator.oscillator.stop() },
  }
}
