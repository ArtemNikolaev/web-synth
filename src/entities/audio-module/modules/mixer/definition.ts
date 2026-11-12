import type { ModuleDefinition } from '../../model/contract.ts'

export const mix = {
  title: 'Mixer',
  group: 'Through',
  inputs: ['audio', 'audio'],
  outputs: ['audio'],
  params: { gain: 1 },
  dynamicPorts: 'in',
  describe: node => node.count + ' входа · Gain ' + node.params.gain,
} satisfies ModuleDefinition
