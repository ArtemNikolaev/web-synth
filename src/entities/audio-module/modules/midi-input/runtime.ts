import type { Module } from '../../model/contract.ts'

export function usesMidiDevice(node: Module, device: string) {
  return node.kind === 'midi' && node.params.device === device
}

export function acceptsMidi(node: Module, device: string, channel: number) {
  return usesMidiDevice(node, device) && (node.params.channel === 0 || node.params.channel === channel)
}

export function changedMidiInput(before: Module, current: Module | undefined) {
  return before.kind === 'midi' &&
    (current?.params.device !== before.params.device || current?.params.channel !== before.params.channel)
}
