import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canConnect, connect, createProject, duplicate, emptyPatch, makeModule, remove, type Module } from '../src/model.ts'
import { importProject } from '../src/storage.ts'

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
  const imported = importProject(JSON.stringify(project))
  assert.notEqual(imported.id, project.id)
  assert.deepEqual(imported.patch, project.patch)
  assert.deepEqual(imported.versions, project.versions)
  project.patch.wires[0].targetHandle = 'in-999'
  assert.throws(() => importProject(JSON.stringify(project)))
})
