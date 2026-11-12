import type { ComponentType } from 'react'
import type { Kind } from './model/catalog.ts'
import { MidiInputControls } from './modules/midi-input/controls.tsx'
import { MidiSynthControls } from './modules/midi-synth/controls.tsx'
import { MixerControls } from './modules/mixer/controls.tsx'
import { OscillatorControls } from './modules/oscillator/controls.tsx'
import { OutputControls } from './modules/output/controls.tsx'
import { SplitterControls } from './modules/splitter/controls.tsx'
import { type ControlProps } from './ui/controls.tsx'

import type { CreateModuleRuntime } from './lib/runtime-contract.ts'
import { createOscillator } from './modules/oscillator/runtime.ts'
import { createMidiSynth } from './modules/midi-synth/runtime.ts'
import { createOutput } from './modules/output/runtime.ts'

type BrowserModule = {
  Controls: ComponentType<ControlProps>
  createRuntime?: CreateModuleRuntime
}

export const browserModules: Record<Kind, BrowserModule> = {
  osc: { Controls: OscillatorControls, createRuntime: createOscillator },
  midi: { Controls: MidiInputControls },
  synth: { Controls: MidiSynthControls, createRuntime: createMidiSynth },
  mix: { Controls: MixerControls },
  split: { Controls: SplitterControls },
  out: { Controls: OutputControls, createRuntime: createOutput },
}
