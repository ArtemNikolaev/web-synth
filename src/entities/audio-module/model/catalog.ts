import { osc } from '../modules/oscillator/definition.ts'
import { midi } from '../modules/midi-input/definition.ts'
import { synth } from '../modules/midi-synth/definition.ts'
import { mix } from '../modules/mixer/definition.ts'
import { split } from '../modules/splitter/definition.ts'
import { out } from '../modules/output/definition.ts'
import type { Module, ModuleDefinition, ParameterRange, Point } from './contract.ts'

const definitions = { osc, midi, synth, mix, split, out }
export type Kind = keyof typeof definitions
export const kinds = Object.keys(definitions) as Kind[]
export const modules: Record<Kind, ModuleDefinition> = definitions

export function ports(module: Module, side: 'in' | 'out') {
  const definition = modules[module.kind]
  const signals = definition.dynamicPorts === side
    ? Array<'audio'>(module.count).fill('audio')
    : definition[side === 'in' ? 'inputs' : 'outputs']
  return signals.map((signal, index) => ({ signal, id: side + '-' + index, index }))
}

export function makeModule(kind: Kind, position: Point): Module {
  const definition = modules[kind]
  const node: Module = { id: crypto.randomUUID(), kind, position, count: 2, params: { ...definition.params } }
  if (definition.initialOscillators) node.oscillators = definition.initialOscillators()
  return node
}

export const gainRange: ParameterRange = [0, 2, 0.01]

export function parameterRange(kind: Kind, key: string) {
  return key === 'gain' ? gainRange : modules[kind].ranges?.[key]
}
