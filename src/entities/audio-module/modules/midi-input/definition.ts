import type { ModuleDefinition } from '../../model/contract.ts'

export const midi = {
  title: 'MIDI Input',
  group: 'Input',
  inputs: [],
  outputs: ['midi'],
  params: { device: '', channel: 0 },
  ranges: { channel: [0, 16, 1] },
  describe: node => node.params.channel ? 'Канал ' + node.params.channel : 'Все каналы',
} satisfies ModuleDefinition
