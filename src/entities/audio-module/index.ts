export { AudioModuleControls } from './ui/module-controls.tsx'
export {
  kinds, makeModule, modules, numeric, oscillatorLayers, ports, setOscillatorLayers,
  type Kind, type Module, type OscillatorLayer, type Point,
} from './model.ts'
export { createModuleRuntime } from './lib/create-module-runtime.ts'
export { type ModuleRuntime } from './lib/runtime-contract.ts'
export { acceptsMidi, changedMidiInput, usesMidiDevice } from './modules/midi-input/runtime.ts'
