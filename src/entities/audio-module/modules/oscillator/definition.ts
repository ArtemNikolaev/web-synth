import type { ModuleDefinition, Module, OscillatorLayer } from '../../model/contract.ts'

const defaults = { wave: 'sine', frequency: 110, gain: 0.18 } as const

export const osc = {
  title: 'Oscillator',
  group: 'Input',
  inputs: [],
  outputs: ['audio'],
  params: defaults,
  initialOscillators: () => [createOscillatorLayer('main')],
  windowHeight: 430,
  ranges: { frequency: [20, 12000, 0.01] },
  describe(node) {
    const layers = oscillatorLayers(node)
    const enabled = layers.filter(layer => layer.enabled).length
    const summary = layers.length === 1 && enabled ? layers[0].wave : enabled + '/' + layers.length + ' активно'
    return summary + ' · ' + node.params.frequency + ' Hz'
  },
} satisfies ModuleDefinition

export function createOscillatorLayer(id: string): OscillatorLayer {
  return { id, wave: defaults.wave, gain: defaults.gain, enabled: true }
}

export function oscillatorLayers(node: Module): OscillatorLayer[] {
  return node.oscillators ?? [{ id: 'main', wave: node.params.wave as OscillatorLayer['wave'], gain: Number(node.params.gain), enabled: true }]
}

export function setOscillatorLayers(node: Module, oscillators: OscillatorLayer[]): Module {
  const { wave, gain } = oscillators[0]
  return { ...node, params: { ...node.params, wave, gain }, oscillators }
}
