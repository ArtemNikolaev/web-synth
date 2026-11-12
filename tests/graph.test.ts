import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeModule, oscillatorLayers, setOscillatorLayers, type Module } from '../src/entities/audio-module/model.ts'
import { canConnect, connect, createProject, duplicate, emptyPatch, importProject, remove, serializeProject } from '../src/entities/project/index.ts'

const node = (kind: Module['kind']) => makeModule(kind, { x: 0, y: 0 })
const wire = (source: Module, target: Module, output = 0, input = 0) => ({
  source: source.id, target: target.id, sourceHandle: 'out-' + output, targetHandle: 'in-' + input,
})

test('auto-Mixer and auto-Splitter expand without replacing existing ports', () => {
  const [a, b, c, x, y, z] = [node('osc'), node('osc'), node('osc'), node('out'), node('out'), node('out')]
  let patch = { ...emptyPatch(), modules: [a, b, c, x, y, z] }
  patch = connect(patch, wire(a, x))
  const firstId = patch.wires[0].id
  patch = connect(patch, wire(b, x))
  patch = connect(patch, wire(c, x))
  patch = connect(patch, wire(a, y))
  patch = connect(patch, wire(a, z))
  const mixers = patch.modules.filter(module => module.kind === 'mix')
  const splitters = patch.modules.filter(module => module.kind === 'split')
  assert.equal(mixers.length, 1)
  assert.equal(splitters.length, 1)
  assert.equal(mixers[0].count, 3)
  assert.equal(splitters[0].count, 3)
  assert.deepEqual(patch.wires.find(edge => edge.id === firstId), { ...wire(splitters[0], mixers[0]), id: firstId })
  assert.equal(patch.wires.length, 7)
  const withoutFirst = remove(patch, new Set(), new Set([firstId]))
  assert.equal(withoutFirst.modules.length, patch.modules.length)
  assert.equal(withoutFirst.wires.length, 6)
})

test('MIDI fan-out uses direct typed cables; wrong types and audio cycles are rejected', () => {
  const [midi, a, b, x, y] = [node('midi'), node('synth'), node('synth'), node('mix'), node('split')]
  let patch = { ...emptyPatch(), modules: [midi, a, b, x, y] }
  patch = connect(patch, wire(midi, a))
  patch = connect(patch, wire(midi, b))
  patch = connect(patch, wire(a, x))
  patch = connect(patch, wire(x, y))
  assert.equal(canConnect(patch, wire(a, b)), false)
  assert.equal(canConnect(patch, wire(y, x)), false)
  assert.equal(canConnect(patch, wire(midi, a)), false)
  assert.equal(patch.modules.length, 5)
})

test('duplicating a group preserves its internal wiring only', () => {
  const [a, b, c] = [node('osc'), node('mix'), node('out')]
  let patch = { ...emptyPatch(), modules: [a, b, c] }
  patch = connect(patch, wire(a, b))
  patch = connect(patch, wire(b, c))
  const copy = duplicate(patch, new Set([a.id, b.id]))
  assert.equal(copy.modules.length, 5)
  assert.deepEqual(copy.wires.slice(2).map(({ id: _id, ...edge }) => edge), [wire(copy.modules[3], copy.modules[4])])
  assert.equal(remove(patch, new Set([b.id]), new Set()).wires.length, 0)
})

test('project JSON round-trips working state and named versions and rejects invalid graphs', () => {
  const [a, b] = [node('osc'), node('out')]
  const project = createProject('Round trip')
  project.patch = connect({ ...project.patch, modules: [a, b] }, wire(a, b))
  project.versions = [{ id: 'saved', name: 'Saved', date: '2026-11-11T00:00:00.000Z', patch: project.patch }]
  const imported = importProject(serializeProject(project))
  assert.notEqual(imported.id, project.id)
  assert.deepEqual(imported.patch, project.patch)
  assert.deepEqual(imported.versions, project.versions)
  project.patch.wires[0].targetHandle = 'in-999'
  assert.throws(() => importProject(serializeProject(project)))
})

test('oscillator layers preserve legacy settings and round-trip independently', () => {
  const legacy = { ...node('osc'), oscillators: undefined, params: { frequency: 220, wave: 'triangle', gain: 0.4 } }
  const [first] = oscillatorLayers(legacy)
  assert.deepEqual(first, { id: 'main', wave: 'triangle', gain: 0.4, enabled: true })

  const project = createProject('Layers')
  project.patch.modules = [legacy]
  const [importedLegacy] = importProject(serializeProject(project)).patch.modules
  assert.equal(importedLegacy.oscillators, undefined)
  assert.deepEqual(oscillatorLayers(importedLegacy), [first])

  const layered = setOscillatorLayers(legacy, [first, { id: 'second', wave: 'square', gain: 0.2, enabled: false }])
  project.patch.modules = [layered]
  assert.deepEqual(importProject(serializeProject(project)).patch.modules, [layered])
  const malformed = setOscillatorLayers(legacy, [first, { ...first, wave: 'square' }])
  project.patch.modules = [malformed]
  assert.throws(() => importProject(serializeProject(project)))
})

test('new oscillators start with four muted waves and persist output gain independently', () => {
  const oscillator = node('osc')
  assert.deepEqual(oscillatorLayers(oscillator).map(({ wave, gain, enabled }) => [wave, gain, enabled]), [
    ['sine', 0, true], ['square', 0, true], ['sawtooth', 0, true], ['triangle', 0, true],
  ])
  assert.equal(oscillator.params.outputGain, 1)

  const project = createProject('Oscillator mix')
  const mixed = setOscillatorLayers(oscillator, oscillatorLayers(oscillator).map(layer =>
    layer.wave === 'triangle' ? { ...layer, gain: 0.6 } : layer))
  project.patch.modules = [{ ...mixed, params: { ...mixed.params, outputGain: 0.25 } }]
  const [restored] = importProject(serializeProject(project)).patch.modules
  assert.equal(restored.params.outputGain, 0.25)
  assert.deepEqual(oscillatorLayers(restored), oscillatorLayers(mixed))
  restored.params.outputGain = 3
  project.patch.modules = [restored]
  assert.throws(() => importProject(serializeProject(project)))
})
