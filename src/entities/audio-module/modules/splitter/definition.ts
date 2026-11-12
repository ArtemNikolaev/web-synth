import type { ModuleDefinition } from '../../model/contract.ts'

export const split = {
  title: 'Splitter',
  group: 'Through',
  inputs: ['audio'],
  outputs: ['audio', 'audio'],
  params: { gain: 1 },
  dynamicPorts: 'out',
  describe: node => node.count + ' выхода · Gain ' + node.params.gain,
} satisfies ModuleDefinition
