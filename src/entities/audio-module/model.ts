// Platform-independent entry point used by the Node.js graph tests.
export { kinds, makeModule, modules, ports, type Kind } from './model/catalog.ts'
export { numeric, type Module, type OscillatorLayer, type Point } from './model/contract.ts'
export { oscillatorLayers, setOscillatorLayers } from './modules/oscillator/definition.ts'
