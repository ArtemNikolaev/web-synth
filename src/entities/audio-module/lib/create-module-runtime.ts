import { browserModules } from '../browser-registry.ts'
import type { Kind } from '../model/catalog.ts'
import type { RuntimeContext } from './runtime-contract.ts'

export function createModuleRuntime(kind: Kind, services: RuntimeContext, bus: GainNode) {
  return browserModules[kind].createRuntime?.(services, bus) ?? {}
}
