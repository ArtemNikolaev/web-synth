import { noteFrequency, numeric, type Module } from '../../model/contract.ts'
import type { CreateModuleRuntime } from '../../lib/runtime-contract.ts'

type Voice = { note: number; channel: number; oscillator: OscillatorNode; level: GainNode; start: number; attack: number; peak: number; released: boolean }

export const createMidiSynth: CreateModuleRuntime = ({ context: ctx }, bus) => {
  const voices = new Set<Voice>()

  function release(voice: Voice, seconds: number) {
    if (voice.released) return
    const now = ctx.currentTime
    voice.released = true
    const gain = voice.level.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(voice.peak * Math.min(1, Math.max(0, now - voice.start) / voice.attack), now)
    gain.setTargetAtTime(0, now, seconds / 5)
    voice.oscillator.stop(now + seconds + 0.015)
  }

  function noteOn(node: Module, note: number, channel: number, velocity: number) {
    const held = [...voices].filter(voice => !voice.released)
    if (held.length >= numeric(node, 'voices')) release(held[0], 0.025)
    const now = ctx.currentTime
    const oscillator = ctx.createOscillator()
    const level = ctx.createGain()
    oscillator.type = node.params.wave as OscillatorType
    oscillator.frequency.value = noteFrequency(note)
    oscillator.connect(level)
    level.connect(bus)
    const peak = velocity / 127 / Math.sqrt(numeric(node, 'voices'))
    level.gain.setValueAtTime(0, now)
    level.gain.linearRampToValueAtTime(peak, now + numeric(node, 'attack'))
    const voice = { note, channel, oscillator, level, start: now, attack: numeric(node, 'attack'), peak, released: false }
    voices.add(voice)
    oscillator.onended = () => {
      oscillator.disconnect()
      level.disconnect()
      voices.delete(voice)
    }
    oscillator.start(now)
  }

  return {
    apply(node) {
      const held = [...voices].filter(voice => !voice.released)
      for (const voice of held.slice(0, Math.max(0, held.length - numeric(node, 'voices')))) release(voice, 0.025)
    },
    onMidi(node, { command, note, channel, velocity }) {
      if (command === 0xb0) {
        for (const voice of voices) if (voice.channel === channel) release(voice, 0.04)
      } else if (command === 0x90 && velocity > 0) {
        noteOn(node, note, channel, velocity)
      } else {
        const voice = [...voices].find(voice => !voice.released && voice.note === note && voice.channel === channel)
        if (voice) release(voice, numeric(node, 'release'))
      }
    },
    releaseAll() { for (const voice of voices) release(voice, 0.04) },
    dispose() { for (const voice of voices) voice.oscillator.stop() },
  }
}
