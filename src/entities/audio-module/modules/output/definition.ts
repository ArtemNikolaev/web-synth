import type { ModuleDefinition } from '../../model/contract.ts'

export const out = {
  title: 'Output',
  group: 'Output',
  inputs: ['audio'],
  outputs: [],
  params: { gain: 0.8, device: '' },
  describe: node => node.params.device ? 'Выбранное устройство' : 'Системный выход',
} satisfies ModuleDefinition
