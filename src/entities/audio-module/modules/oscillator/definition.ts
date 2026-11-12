import { numeric, waves, type ModuleDefinition, type Module, type OscillatorLayer } from '../../model/contract.ts'

const defaults = { wave: 'sine', frequency: 110, gain: 0, outputGain: 1 } as const

export const osc = {
  title: 'Oscillator',
  group: 'Input',
  inputs: [],
  outputs: ['audio'],
  params: defaults,
  initialOscillators: () => waves.map(wave => ({ id: wave, wave, gain: 0, enabled: true })),
  windowHeight: 560,
  optionalParams: ['outputGain'],
  ranges: { frequency: [20, 12000, 0.01], outputGain: [0, 2, 0.01] },
  describe(node) {
    const sounding = numeric(node, 'outputGain') === 0 ? [] : waves.filter(wave => waveGain(oscillatorLayers(node), wave) > 0)
    return (sounding.join(' + ') || 'Без сигнала') + ' · ' + node.params.frequency + ' Hz'
  },
} satisfies ModuleDefinition

export function oscillatorLayers(node: Module): OscillatorLayer[] {
  return node.oscillators ?? [{ id: 'main', wave: node.params.wave as OscillatorLayer['wave'], gain: Number(node.params.gain), enabled: true }]
}

export function waveGain(layers: OscillatorLayer[], wave: OscillatorLayer['wave']) {
  return layers.reduce((gain, layer) => layer.enabled && layer.wave === wave ? gain + layer.gain : gain, 0)
}

export function setWaveGain(layers: OscillatorLayer[], wave: OscillatorLayer['wave'], gain: number) {
  const previous = waveGain(layers, wave)
  if (previous === gain) return layers
  const first = layers.find(layer => layer.enabled && layer.wave === wave)
  if (!first) return [...layers, { id: crypto.randomUUID(), wave, gain, enabled: true }]
  return layers.map(layer => {
    if (!layer.enabled || layer.wave !== wave) return layer
    const nextGain = previous === 0 ? (layer === first ? gain : 0) : gain * (layer.gain / previous)
    return { ...layer, gain: nextGain }
  })
}

export function setOscillatorLayers(node: Module, oscillators: OscillatorLayer[]): Module {
  const { wave, gain } = oscillators[0]
  return { ...node, params: { ...node.params, wave, gain }, oscillators }
}
