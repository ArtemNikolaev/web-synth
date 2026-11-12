import type { Kind } from './catalog.ts'

export type Signal = 'audio' | 'midi'
export type Point = { x: number; y: number }
export const waves = ['sine', 'square', 'sawtooth', 'triangle'] as const
export type OscillatorLayer = { id: string; wave: typeof waves[number]; gain: number; enabled: boolean }

export type Module = {
  id: string
  kind: Kind
  position: Point
  count: number
  params: Record<string, string | number>
  oscillators?: OscillatorLayer[]
  auto?: true
}

export type ParameterRange = readonly [min: number, max: number, step: number]

export type ModuleDefinition = {
  title: string
  group: 'Input' | 'Through' | 'Output'
  inputs: readonly Signal[]
  outputs: readonly Signal[]
  params: Record<string, string | number>
  ranges?: Readonly<Record<string, ParameterRange>>
  optionalParams?: readonly string[]
  dynamicPorts?: 'in' | 'out'
  initialOscillators?: () => OscillatorLayer[]
  windowHeight?: number
  describe: (node: Module) => string
}

export const numeric = (node: Module, key: string, fallback = 1) => Number(node.params[key] ?? fallback)
export const noteFrequency = (note: number) => 440 * 2 ** ((note - 69) / 12)
