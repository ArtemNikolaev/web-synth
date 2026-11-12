import type { Module } from '../model/contract.ts'

export type MidiNote = { command: number; note: number; channel: number; velocity: number }
export type RuntimeContext = {
  context: AudioContext
  master: DynamicsCompressorNode
  ramp: (param: AudioParam, value: number) => void
  setWarning: (message?: string) => void
  hasWarning: () => boolean
  changed: () => void
}

export type ModuleRuntime = {
  apply?: (node: Module) => void
  onMidi?: (node: Module, event: MidiNote) => void
  releaseAll?: () => void
  refreshRoute?: (node: Module, available: Set<string>) => void
  deactivate?: () => void
  dispose?: () => void
  fixedBusGain?: number
}

export type CreateModuleRuntime = (services: RuntimeContext, bus: GainNode) => ModuleRuntime
