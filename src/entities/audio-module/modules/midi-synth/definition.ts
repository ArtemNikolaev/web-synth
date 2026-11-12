import type { ModuleDefinition } from '../../model/contract.ts'

export const synth = {
  title: 'MIDI Synth',
  group: 'Through',
  inputs: ['midi'],
  outputs: ['audio'],
  params: { wave: 'triangle', voices: 5, attack: 0.015, release: 0.22, gain: 0.25 },
  ranges: { voices: [1, 32, 1], attack: [0.001, 2, 0.001], release: [0.01, 5, 0.01] },
  describe: node => 'Полифония · ' + node.params.voices,
} satisfies ModuleDefinition
