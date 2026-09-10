import { TowerKind, CreepArchetypeKind } from '@ltw/sim'
import { Budget, crowdGain, place, pitch, PENTATONIC, CHORDS } from './mixer'
import { seeded } from '../render/textures'

/**
 * Every sound in the game, synthesised.
 *
 * No audio files, for the same reason there are no model files: the
 * repository carries no binaries, and a sound described as an envelope on an
 * oscillator is a diff someone can read and tune. Web Audio is enough for the
 * whole palette this game needs -- bow twangs, mortar thumps, frost chimes,
 * hammer blows, coins, a bell for a lost life -- and for a bed under it: a
 * slow minor pad that follows a four-chord cycle, plucked notes on a
 * pentatonic that cannot clash with it, wind, birds when the field is quiet
 * and a drum when it is not.
 *
 * Events arrive from the scene, which already infers shots, hits, deaths and
 * leaks by comparing two ticks (ADR-0015). Nothing here reads sim state.
 *
 * Two constraints shape the code. Browsers refuse to start an AudioContext
 * without a user gesture, so nothing is created until `start()`, which the
 * start screen's button calls, and a later gesture resumes it if the browser
 * suspended it. And a flood produces hundreds of events a second, so every
 * frequent event goes through a `Budget` and plays one sound whose loudness
 * says how many it stands for -- see `mixer.ts`.
 */

export interface Audio {
  /** Create or resume the context. Must be called from a user gesture. */
  start(): void
  /** Where the camera is looking and how wide the frame is, in world units. */
  setListener(x: number, z: number, halfWidth: number): void
  /** How busy the field is, 0..1. Drives the bed and the ambience. */
  setIntensity(v: number): void
  /** Advance the music scheduler. Once a frame is fine; it looks ahead. */
  update(): void
  setMuted(muted: boolean): void
  readonly muted: boolean
  /** 0..1, applied before the master compressor. */
  setVolume(v: number): void
  readonly volume: number

  shot(kind: TowerKind, x: number, z: number): void
  hit(kind: TowerKind, x: number, z: number): void
  death(kind: CreepArchetypeKind, x: number, z: number): void
  /** A life lost. `mine` is a warning; the opponent's is good news. */
  leak(mine: boolean, x: number, z: number): void
  build(kind: TowerKind, x: number, z: number, mine: boolean): void
  upgrade(x: number, z: number, mine: boolean): void
  sell(x: number, z: number): void
  send(): void
  income(): void
  tierUnlock(): void
  select(): void
  refused(): void
  click(): void
  matchEnd(won: boolean): void
}

/** The key everything sits in. A low A: the bed's root and the pluck's floor. */
const ROOT = 110
const CHORD_SECONDS = 8

type Ctx = AudioContext

interface Voice {
  readonly pan: number
  readonly gain: number
}

export function createAudio(): Audio {
  let ctx: Ctx | null = null
  let master: GainNode | null = null
  let sfx: GainNode | null = null
  let music: GainNode | null = null
  let ambience: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let muted = false
  let volume = 0.8

  // Listener, and the scratch `place` writes through.
  let lx = 0
  let lz = 0
  let halfW = 12
  const placed = { pan: 0, gain: 1 }
  let intensityNow = 0

  const budgets = {
    shot: [new Budget(70, 10), new Budget(140, 5), new Budget(90, 8)],
    hit: [new Budget(80, 8), new Budget(150, 5), new Budget(100, 6)],
    death: [new Budget(80, 8), new Budget(110, 6), new Budget(160, 5)],
    leak: new Budget(250, 4),
    send: new Budget(110, 8),
    refused: new Budget(180, 5),
  }

  const rnd = seeded(7)

  function applyMaster(): void {
    if (!master || !ctx) return
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02)
  }

  function start(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume()
      return
    }
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    ctx = new Ctor()
    // A compressor on the master keeps a flood from clipping: many sounds at
    // once get squashed rather than distorted.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.knee.value = 20
    comp.ratio.value = 6
    comp.attack.value = 0.005
    comp.release.value = 0.2
    master = ctx.createGain()
    master.gain.value = muted ? 0 : volume
    master.connect(comp)
    comp.connect(ctx.destination)
    sfx = ctx.createGain()
    sfx.gain.value = 0.9
    sfx.connect(master)
    music = ctx.createGain()
    music.gain.value = 0.55
    music.connect(master)
    ambience = ctx.createGain()
    ambience.gain.value = 0.5
    ambience.connect(master)

    // Two seconds of white noise, reused by every noisy sound.
    const len = ctx.sampleRate * 2
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    const r = seeded(3)
    for (let i = 0; i < len; i++) data[i] = r() * 2 - 1

    startBed()
    startAmbience()

    // The browser may suspend the context when the tab hides; any later
    // gesture brings it back.
    const resume = (): void => {
      if (ctx && ctx.state === 'suspended') void ctx.resume()
    }
    window.addEventListener('pointerdown', resume, { passive: true })
    window.addEventListener('keydown', resume, { passive: true })
  }

  // ---- primitives ---------------------------------------------------------

  function voiceAt(x: number, z: number): Voice {
    place(x, z, lx, lz, halfW, placed)
    return placed
  }

  /** A gain -> panner chain into a bus, with an envelope already scheduled. */
  function envelope(
    bus: GainNode,
    t0: number,
    peak: number,
    attack: number,
    dur: number,
    pan: number,
  ): GainNode {
    const c = ctx as Ctx
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.linearRampToValueAtTime(peak, t0 + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    const p = c.createStereoPanner()
    p.pan.value = pan
    g.connect(p)
    p.connect(bus)
    return g
  }

  interface ToneSpec {
    type: OscillatorType
    f0: number
    f1?: number
    dur: number
    gain: number
    attack?: number
    pan?: number
    detune?: number
    lowpass?: number
    bus?: GainNode | null
    at?: number
  }

  function tone(s: ToneSpec): void {
    if (!ctx || !sfx) return
    const t0 = s.at ?? ctx.currentTime
    const g = envelope(s.bus ?? sfx, t0, s.gain, s.attack ?? 0.005, s.dur, s.pan ?? 0)
    const o = ctx.createOscillator()
    o.type = s.type
    o.frequency.setValueAtTime(s.f0, t0)
    if (s.f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(1, s.f1), t0 + s.dur)
    if (s.detune) o.detune.value = s.detune
    if (s.lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = s.lowpass
      o.connect(f)
      f.connect(g)
    } else {
      o.connect(g)
    }
    o.start(t0)
    o.stop(t0 + s.dur + 0.05)
  }

  interface NoiseSpec {
    dur: number
    gain: number
    attack?: number
    pan?: number
    filter?: BiquadFilterType
    f0?: number
    f1?: number
    q?: number
    bus?: GainNode | null
    at?: number
  }

  function noise(s: NoiseSpec): void {
    if (!ctx || !sfx || !noiseBuffer) return
    const t0 = s.at ?? ctx.currentTime
    const g = envelope(s.bus ?? sfx, t0, s.gain, s.attack ?? 0.003, s.dur, s.pan ?? 0)
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    src.playbackRate.value = 1
    // A random start point so two bursts in a row do not sound identical.
    const offset = rnd() * 1.5
    if (s.filter) {
      const f = ctx.createBiquadFilter()
      f.type = s.filter
      f.frequency.setValueAtTime(s.f0 ?? 1000, t0)
      if (s.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, s.f1), t0 + s.dur)
      f.Q.value = s.q ?? 1
      src.connect(f)
      f.connect(g)
    } else {
      src.connect(g)
    }
    src.start(t0, offset)
    src.stop(t0 + s.dur + 0.05)
  }

  // ---- the palette --------------------------------------------------------

  function shot(kind: TowerKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.shot[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    switch (kind) {
      case TowerKind.Single:
        // Bowstring: a short bright noise snap and a falling twang.
        noise({ dur: 0.06, gain: crowdGain(n, 0.12) * v.gain, filter: 'bandpass', f0: 2400, f1: 900, q: 2, pan: v.pan })
        tone({ type: 'triangle', f0: 700, f1: 240, dur: 0.09, gain: crowdGain(n, 0.05) * v.gain, pan: v.pan })
        return
      case TowerKind.Splash:
        // Mortar: a deep thump with a puff of air.
        tone({ type: 'sine', f0: 130, f1: 38, dur: 0.28, gain: crowdGain(n, 0.5) * v.gain, attack: 0.004, pan: v.pan })
        noise({ dur: 0.22, gain: crowdGain(n, 0.18) * v.gain, filter: 'lowpass', f0: 500, f1: 120, pan: v.pan })
        return
      case TowerKind.Slow:
        // Frost: a glassy chime with a little shimmer.
        tone({ type: 'sine', f0: 1180, f1: 1560, dur: 0.22, gain: crowdGain(n, 0.07) * v.gain, attack: 0.01, pan: v.pan })
        tone({ type: 'sine', f0: 2360, f1: 2900, dur: 0.16, gain: crowdGain(n, 0.03) * v.gain, attack: 0.01, pan: v.pan, detune: 8 })
        return
    }
  }

  function hit(kind: TowerKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.hit[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    switch (kind) {
      case TowerKind.Single:
        noise({ dur: 0.05, gain: crowdGain(n, 0.14) * v.gain, filter: 'highpass', f0: 1800, pan: v.pan })
        tone({ type: 'square', f0: 520, f1: 180, dur: 0.06, gain: crowdGain(n, 0.03) * v.gain, pan: v.pan, lowpass: 1200 })
        return
      case TowerKind.Splash:
        // The shell landing: sub thump, then a rolling boom.
        tone({ type: 'sine', f0: 90, f1: 30, dur: 0.35, gain: crowdGain(n, 0.6) * v.gain, attack: 0.003, pan: v.pan })
        noise({ dur: 0.45, gain: crowdGain(n, 0.32) * v.gain, filter: 'lowpass', f0: 900, f1: 90, attack: 0.005, pan: v.pan })
        return
      case TowerKind.Slow:
        // Ice cracking: two high partials and a tick.
        tone({ type: 'sine', f0: 2600, f1: 1900, dur: 0.25, gain: crowdGain(n, 0.06) * v.gain, attack: 0.002, pan: v.pan })
        tone({ type: 'sine', f0: 3900, f1: 3300, dur: 0.18, gain: crowdGain(n, 0.03) * v.gain, attack: 0.002, pan: v.pan })
        noise({ dur: 0.04, gain: crowdGain(n, 0.08) * v.gain, filter: 'highpass', f0: 3000, pan: v.pan })
        return
    }
  }

  function death(kind: CreepArchetypeKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.death[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    switch (kind) {
      case CreepArchetypeKind.Swarm:
        // A beetle popping: a wet click and a short squeal.
        noise({ dur: 0.07, gain: crowdGain(n, 0.16) * v.gain, filter: 'bandpass', f0: 1400, f1: 500, q: 3, pan: v.pan })
        tone({ type: 'sawtooth', f0: 1500, f1: 600, dur: 0.09, gain: crowdGain(n, 0.03) * v.gain, pan: v.pan, lowpass: 2200 })
        return
      case CreepArchetypeKind.Runner:
        // A yelp: up, then down.
        tone({ type: 'sawtooth', f0: 520, f1: 980, dur: 0.07, gain: crowdGain(n, 0.06) * v.gain, pan: v.pan, lowpass: 1800 })
        tone({ type: 'sawtooth', f0: 980, f1: 320, dur: 0.16, gain: crowdGain(n, 0.06) * v.gain, pan: v.pan, lowpass: 1600, at: ctx.currentTime + 0.07 })
        return
      case CreepArchetypeKind.Tank:
        // An ogre going down: a low groan and the ground taking it.
        tone({ type: 'sawtooth', f0: 140, f1: 62, dur: 0.45, gain: crowdGain(n, 0.14) * v.gain, attack: 0.02, pan: v.pan, lowpass: 500 })
        noise({ dur: 0.3, gain: crowdGain(n, 0.22) * v.gain, filter: 'lowpass', f0: 400, f1: 80, pan: v.pan, at: ctx.currentTime + 0.25 })
        return
    }
  }

  function leak(mine: boolean, x: number, z: number): void {
    if (!ctx) return
    const n = budgets.leak.take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    if (mine) {
      // A bell you do not want to hear: two descending tones and a low toll.
      tone({ type: 'square', f0: 880, dur: 0.16, gain: 0.09 * v.gain, pan: v.pan, lowpass: 2400, at: t })
      tone({ type: 'square', f0: 622, dur: 0.24, gain: 0.09 * v.gain, pan: v.pan, lowpass: 2400, at: t + 0.16 })
      tone({ type: 'sine', f0: 196, dur: 0.6, gain: 0.25 * v.gain, attack: 0.01, pan: v.pan, at: t + 0.02 })
    } else {
      // Theirs: a bright two-note chime, rising.
      tone({ type: 'sine', f0: pitch(ROOT, 24), dur: 0.14, gain: 0.12 * v.gain, pan: v.pan, at: t })
      tone({ type: 'sine', f0: pitch(ROOT, 31), dur: 0.3, gain: 0.12 * v.gain, pan: v.pan, at: t + 0.12 })
    }
  }

  function build(kind: TowerKind, x: number, z: number, mine: boolean): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const g = mine ? 1 : 0.45
    const t = ctx.currentTime
    // Two hammer blows on stone, then a material note per kind.
    for (let i = 0; i < 2; i++) {
      noise({ dur: 0.08, gain: 0.22 * g * v.gain, filter: 'bandpass', f0: 700 + i * 200, q: 1.5, pan: v.pan, at: t + i * 0.11 })
      tone({ type: 'sine', f0: 210, f1: 120, dur: 0.1, gain: 0.18 * g * v.gain, pan: v.pan, at: t + i * 0.11 })
    }
    if (kind === TowerKind.Splash) {
      tone({ type: 'triangle', f0: 160, f1: 110, dur: 0.3, gain: 0.14 * g * v.gain, pan: v.pan, at: t + 0.24 })
    } else if (kind === TowerKind.Slow) {
      tone({ type: 'sine', f0: 1400, f1: 1800, dur: 0.3, gain: 0.06 * g * v.gain, attack: 0.02, pan: v.pan, at: t + 0.24 })
    }
  }

  function upgrade(x: number, z: number, mine: boolean): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const g = mine ? 1 : 0.45
    const t = ctx.currentTime
    // A rising three-note arpeggio on the chord, in glass.
    const steps = [12, 19, 24]
    steps.forEach((s, i) => {
      tone({ type: 'sine', f0: pitch(ROOT * 2, s), dur: 0.35, gain: 0.1 * g * v.gain, attack: 0.01, pan: v.pan, at: t + i * 0.08 })
      tone({ type: 'triangle', f0: pitch(ROOT * 4, s), dur: 0.2, gain: 0.03 * g * v.gain, attack: 0.01, pan: v.pan, at: t + i * 0.08 })
    })
  }

  function sell(x: number, z: number): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    // Stone coming down, then coins.
    noise({ dur: 0.3, gain: 0.2 * v.gain, filter: 'lowpass', f0: 600, f1: 150, pan: v.pan, at: t })
    coins(t + 0.15, 3, 0.8 * v.gain, v.pan)
  }

  function coins(t: number, count: number, gain: number, pan: number): void {
    for (let i = 0; i < count; i++) {
      const f = 2200 + rnd() * 900
      tone({ type: 'sine', f0: f, f1: f * 0.98, dur: 0.12, gain: 0.07 * gain, attack: 0.002, pan, at: t + i * 0.055 })
      tone({ type: 'sine', f0: f * 2.7, dur: 0.05, gain: 0.02 * gain, attack: 0.002, pan, at: t + i * 0.055 })
    }
  }

  function send(): void {
    if (!ctx || budgets.send.take(performance.now()) === 0) return
    // A whoosh out of the frame: rising band of air, panned slightly right,
    // toward the opponent's board.
    noise({ dur: 0.28, gain: 0.16, attack: 0.03, filter: 'bandpass', f0: 350, f1: 2400, q: 1.2, pan: 0.4 })
  }

  function income(): void {
    if (!ctx) return
    coins(ctx.currentTime, 2, 0.9, 0)
  }

  function tierUnlock(): void {
    if (!ctx) return
    const t = ctx.currentTime
    // A short brass call: three rising sawtooth notes, held on the last.
    const notes = [0, 7, 12]
    notes.forEach((s, i) => {
      const dur = i === notes.length - 1 ? 0.9 : 0.22
      tone({ type: 'sawtooth', f0: pitch(ROOT * 2, s), dur, gain: 0.12, attack: 0.03, lowpass: 1800, at: t + i * 0.2 })
      tone({ type: 'sawtooth', f0: pitch(ROOT * 2, s), dur, gain: 0.08, attack: 0.03, lowpass: 1800, detune: 9, at: t + i * 0.2 })
    })
  }

  function select(): void {
    if (!ctx) return
    tone({ type: 'sine', f0: 1050, f1: 1250, dur: 0.05, gain: 0.05, attack: 0.002 })
  }

  function click(): void {
    if (!ctx) return
    tone({ type: 'triangle', f0: 640, f1: 520, dur: 0.05, gain: 0.06, attack: 0.002 })
  }

  function refused(): void {
    if (!ctx || budgets.refused.take(performance.now()) === 0) return
    tone({ type: 'square', f0: 160, f1: 140, dur: 0.14, gain: 0.07, attack: 0.005, lowpass: 900 })
  }

  function matchEnd(won: boolean): void {
    if (!ctx) return
    const t = ctx.currentTime
    const chord = won ? [0, 4, 7, 12, 16] : [0, 3, 7, 10, 12]
    chord.forEach((s, i) => {
      tone({ type: 'triangle', f0: pitch(ROOT * (won ? 2 : 1), s), dur: 2.4, gain: 0.1, attack: 0.15 + i * 0.05, lowpass: 2000, at: t + i * 0.06 })
    })
    if (!won) tone({ type: 'sine', f0: 55, dur: 2.5, gain: 0.25, attack: 0.1, at: t })
  }

  // ---- the bed ------------------------------------------------------------
  //
  // Four detuned triangle voices holding a chord through a slow lowpass,
  // stepping round the cycle every CHORD_SECONDS with a glide, and a pluck
  // every second or two on the pentatonic. Scheduled a little ahead of the
  // clock from `update()`, so a dropped frame never leaves a gap.

  let padVoices: OscillatorNode[] = []
  let padFilter: BiquadFilterNode | null = null
  let padGain: GainNode | null = null
  let chordIndex = 0
  let nextChordAt = 0
  let nextPluckAt = 0
  let nextDrumAt = 0
  let nextBirdAt = 0
  let windGain: GainNode | null = null

  function startBed(): void {
    if (!ctx || !music) return
    padGain = ctx.createGain()
    padGain.gain.value = 0.0001
    padFilter = ctx.createBiquadFilter()
    padFilter.type = 'lowpass'
    padFilter.frequency.value = 700
    padFilter.Q.value = 0.7
    padGain.connect(padFilter)
    padFilter.connect(music)
    // A slow wobble on the filter so the pad breathes.
    const lfo = ctx.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = 0.07
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 220
    lfo.connect(lfoGain)
    lfoGain.connect(padFilter.frequency)
    lfo.start()

    const chord = CHORDS[0] as readonly number[]
    padVoices = chord.map((s, i) => {
      const o = (ctx as Ctx).createOscillator()
      o.type = i === 0 ? 'sawtooth' : 'triangle'
      o.frequency.value = pitch(ROOT, s)
      o.detune.value = (i % 2 === 0 ? 1 : -1) * 6
      const g = (ctx as Ctx).createGain()
      g.gain.value = i === 0 ? 0.35 : 0.5
      o.connect(g)
      g.connect(padGain as GainNode)
      o.start()
      return o
    })
    // Fade the bed in over a few seconds rather than starting on a bar.
    padGain.gain.setTargetAtTime(0.16, ctx.currentTime, 2.5)
    nextChordAt = ctx.currentTime + CHORD_SECONDS
    nextPluckAt = ctx.currentTime + 1.5
    nextDrumAt = ctx.currentTime + 1
  }

  function startAmbience(): void {
    if (!ctx || !ambience || !noiseBuffer) return
    // Wind: low noise under a slowly moving lowpass.
    const src = ctx.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 320
    f.Q.value = 0.5
    windGain = ctx.createGain()
    windGain.gain.value = 0.0001
    src.connect(f)
    f.connect(windGain)
    windGain.connect(ambience)
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = ctx.createGain()
    lfoGain.gain.value = 140
    lfo.connect(lfoGain)
    lfoGain.connect(f.frequency)
    lfo.start()
    src.start()
    windGain.gain.setTargetAtTime(0.12, ctx.currentTime, 3)
    nextBirdAt = ctx.currentTime + 2
  }

  function bird(at: number): void {
    if (!ctx || !ambience) return
    // Two or three quick upward chirps, far off to one side.
    const pan = (rnd() - 0.5) * 1.6
    const base = 2400 + rnd() * 1200
    const n = 2 + Math.floor(rnd() * 2)
    for (let i = 0; i < n; i++) {
      tone({ type: 'sine', f0: base, f1: base * 1.35, dur: 0.09, gain: 0.05, attack: 0.01, pan, bus: ambience, at: at + i * 0.13 })
    }
  }

  function update(): void {
    if (!ctx || !music || !padGain) return
    const now = ctx.currentTime
    const ahead = now + 0.25

    // Chord changes: glide every voice to the next chord's tones.
    while (nextChordAt < ahead) {
      chordIndex = (chordIndex + 1) % CHORDS.length
      const chord = CHORDS[chordIndex] as readonly number[]
      padVoices.forEach((o, i) => {
        o.frequency.setTargetAtTime(pitch(ROOT, chord[i] as number), nextChordAt, 0.4)
      })
      nextChordAt += CHORD_SECONDS
    }

    // Plucks: a harp-like note on the pentatonic, sparser when the field is
    // busy so the drum has room.
    while (nextPluckAt < ahead) {
      const s = PENTATONIC[Math.floor(rnd() * PENTATONIC.length)] as number
      const f = pitch(ROOT * 2, s)
      tone({ type: 'triangle', f0: f, dur: 1.1, gain: 0.09, attack: 0.004, pan: (rnd() - 0.5) * 0.8, bus: music, at: nextPluckAt })
      tone({ type: 'sine', f0: f * 2, dur: 0.5, gain: 0.03, attack: 0.004, pan: 0, bus: music, at: nextPluckAt })
      nextPluckAt += 0.9 + rnd() * 1.4 + intensityNow * 0.8
    }

    // The drum: a soft kick on a steady pulse, only under pressure.
    while (nextDrumAt < ahead) {
      if (intensityNow > 0.25) {
        const g = 0.18 * (intensityNow - 0.25)
        tone({ type: 'sine', f0: 95, f1: 42, dur: 0.22, gain: g, attack: 0.003, bus: music, at: nextDrumAt })
        noise({ dur: 0.05, gain: g * 0.5, filter: 'lowpass', f0: 600, bus: music, at: nextDrumAt })
      }
      nextDrumAt += 60 / 96
    }

    // Birds only over a quiet field.
    while (nextBirdAt < ahead) {
      if (intensityNow < 0.35) bird(nextBirdAt)
      nextBirdAt += 3 + rnd() * 6
    }

    // The pad opens up with the fight.
    if (padFilter) padFilter.frequency.setTargetAtTime(600 + intensityNow * 900, now, 1.5)
    if (windGain) windGain.gain.setTargetAtTime(0.12 - intensityNow * 0.07, now, 2)
  }

  return {
    start,
    setListener: (x, z, half) => {
      lx = x
      lz = z
      halfW = half
    },
    setIntensity: (v) => {
      intensityNow = v
    },
    update,
    setMuted: (m) => {
      muted = m
      applyMaster()
    },
    get muted() {
      return muted
    },
    setVolume: (v) => {
      volume = v < 0 ? 0 : v > 1 ? 1 : v
      applyMaster()
    },
    get volume() {
      return volume
    },
    shot,
    hit,
    death,
    leak,
    build,
    upgrade,
    sell,
    send,
    income,
    tierUnlock,
    select,
    refused,
    click,
    matchEnd,
  }
}
