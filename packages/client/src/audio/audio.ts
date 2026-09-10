import { TowerKind, CreepArchetypeKind } from '@ltw/sim'
import { Budget, crowdGain, place, pitch, arpeggio, CHORDS, MOTIF, BPM, BEATS_PER_CHORD } from './mixer'
import { seeded } from '../render/textures'

/**
 * Every sound in the game, synthesised in the idiom of the map it descends
 * from.
 *
 * No audio files, for the same reason there are no model files: the
 * repository carries no binaries, and a sound described as an envelope on an
 * oscillator is a diff someone can read and tune. What makes Warcraft 3 sound
 * the way it does is less its instruments than its TREATMENT, and treatment
 * is all synthesis:
 *
 *   - everything sits in a hall. One convolution reverb with a synthesised
 *     impulse, fed by per-bus sends: a little on effects, a lot on music.
 *   - a hit is three layers: a click, a body with real low end, a tail. A
 *     mortar is a crack, a sub thump and a second of falling rumble, not a
 *     sine sweep.
 *   - timbres are dark and a little gritty: filtered saws and shaped noise
 *     through a soft clipper, nothing above what a 22kHz sample of the era
 *     would carry.
 *   - nothing repeats exactly. Every event is pitch-varied a few percent, the
 *     way a sound bank with five variants would play.
 *   - the music is orchestral pastiche at a march's pace: detuned string
 *     swells, a formant choir, harp arpeggios on the chord, a solemn horn
 *     line, timpani on the changes when the field is busy.
 *
 * Events arrive from the scene, which already infers shots, hits, deaths and
 * leaks by comparing two ticks (ADR-0015). Nothing here reads sim state.
 * Browsers refuse audio without a gesture, so nothing exists until
 * `start()`, which the start screen's button calls. A flood produces
 * hundreds of events a second, so frequent kinds pass a `Budget` and one
 * sound plays a little louder for the events it stands for (`mixer.ts`).
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

/** The key everything sits in: A. The pad's root an octave below the horn. */
const ROOT = 110
const BEAT = 60 / BPM

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
  let reverbIn: GainNode | null = null
  let noiseBuffer: AudioBuffer | null = null
  let muted = false
  let volume = 0.8

  let lx = 0
  let lz = 0
  let halfW = 12
  const placed = { pan: 0, gain: 1 }
  let intensityNow = 0

  const budgets = {
    shot: [new Budget(70, 10), new Budget(160, 5), new Budget(90, 8)],
    hit: [new Budget(80, 8), new Budget(180, 5), new Budget(100, 6)],
    death: [new Budget(90, 8), new Budget(120, 6), new Budget(200, 4)],
    leak: new Budget(300, 4),
    send: new Budget(110, 8),
    refused: new Budget(180, 5),
  }

  const rnd = seeded(7)
  /** A few percent either way, so no two shots are the same shot. */
  const vary = (f: number, cents = 60): number => f * Math.pow(2, ((rnd() * 2 - 1) * cents) / 1200)

  function applyMaster(): void {
    if (!master || !ctx) return
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02)
  }

  function start(): void {
    if (ctx) {
      if (ctx.state === 'suspended') void ctx.resume()
      return
    }
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return
    ctx = new Ctor()

    // Master: soft clip for grit, then a compressor so a flood squashes
    // rather than distorts, then out.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 18
    comp.ratio.value = 5
    comp.attack.value = 0.004
    comp.release.value = 0.25
    master = ctx.createGain()
    master.gain.value = muted ? 0 : volume
    const shaper = ctx.createWaveShaper()
    shaper.curve = softClip()
    shaper.oversample = '2x'
    master.connect(shaper)
    shaper.connect(comp)
    comp.connect(ctx.destination)

    // The hall. One convolver; every bus sends into it by its own amount.
    const convolver = ctx.createConvolver()
    convolver.buffer = impulse(ctx, 2.2, 0.35)
    reverbIn = ctx.createGain()
    reverbIn.gain.value = 1
    reverbIn.connect(convolver)
    const reverbOut = ctx.createGain()
    reverbOut.gain.value = 0.9
    convolver.connect(reverbOut)
    reverbOut.connect(master)

    const bus = (dry: number, wet: number): GainNode => {
      const c = ctx as Ctx
      const g = c.createGain()
      g.gain.value = 1
      // The era's samples carried little above six kilohertz; neither do we.
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6500
      lp.Q.value = 0.5
      g.connect(lp)
      const d = c.createGain()
      d.gain.value = dry
      lp.connect(d)
      d.connect(master as GainNode)
      const s = c.createGain()
      s.gain.value = wet
      lp.connect(s)
      s.connect(reverbIn as GainNode)
      return g
    }
    sfx = bus(0.85, 0.28)
    music = bus(0.5, 0.55)
    ambience = bus(0.45, 0.2)

    // Two seconds of noise, reused by every noisy sound.
    const len = ctx.sampleRate * 2
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    const r = seeded(3)
    for (let i = 0; i < len; i++) data[i] = r() * 2 - 1

    startBed()
    startAmbience()

    const resume = (): void => {
      if (ctx && ctx.state === 'suspended') void ctx.resume()
    }
    window.addEventListener('pointerdown', resume, { passive: true })
    window.addEventListener('keydown', resume, { passive: true })
  }

  /** A gentle tanh curve: adds harmonics to loud transients, leaves quiet ones alone. */
  function softClip(): Float32Array<ArrayBuffer> {
    const n = 1024
    const curve = new Float32Array(new ArrayBuffer(n * 4))
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4)
    }
    return curve
  }

  /**
   * A hall's impulse: stereo noise decaying exponentially, darkening as it
   * goes -- a first-order lowpass whose cutoff falls with the tail, which is
   * what stone walls do to the highs.
   */
  function impulse(c: Ctx, seconds: number, tone: number): AudioBuffer {
    const len = Math.floor(c.sampleRate * seconds)
    const buf = c.createBuffer(2, len, c.sampleRate)
    const r = seeded(11)
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch)
      let lp = 0
      for (let i = 0; i < len; i++) {
        const t = i / len
        const env = Math.pow(1 - t, 2.4)
        const a = 0.15 + tone * (1 - t) * 0.7
        lp += (r() * 2 - 1 - lp) * a
        // A little early-reflection density in the first 40ms.
        const early = i < c.sampleRate * 0.04 ? 1.6 : 1
        d[i] = lp * env * early
      }
    }
    return buf
  }

  // ---- primitives ---------------------------------------------------------

  function voiceAt(x: number, z: number): Voice {
    place(x, z, lx, lz, halfW, placed)
    return placed
  }

  function envelope(bus: GainNode, t0: number, peak: number, attack: number, dur: number, pan: number): GainNode {
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
    /** Vibrato depth in cents and rate in Hz. Horns and voices have it; bells do not. */
    vibrato?: readonly [number, number]
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
    if (s.vibrato) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = s.vibrato[1]
      const depth = ctx.createGain()
      depth.gain.value = s.vibrato[0]
      lfo.connect(depth)
      depth.connect(o.detune)
      lfo.start(t0)
      lfo.stop(t0 + s.dur + 0.05)
    }
    if (s.lowpass) {
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = s.lowpass
      f.Q.value = 0.8
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

  /**
   * A struck bell: inharmonic partials at the ratios a small bronze bell
   * rings, the upper ones dying first. Upgrades, coins and the life-lost
   * toll are all this at different sizes.
   */
  function bell(f: number, dur: number, gain: number, pan: number, at: number, bus: GainNode | null = null): void {
    const partials: readonly [number, number, number][] = [
      [1, 1, 1],
      [2.41, 0.5, 0.55],
      [3.9, 0.3, 0.35],
      [5.4, 0.16, 0.22],
    ]
    for (const [ratio, amp, life] of partials) {
      tone({ type: 'sine', f0: f * ratio, dur: dur * life, gain: gain * amp, attack: 0.002, pan, at, bus })
    }
  }

  /** A horn: two detuned saws under a lowpass with slow vibrato that comes in late. */
  function horn(f: number, dur: number, gain: number, pan: number, at: number, bus: GainNode | null = null): void {
    tone({ type: 'sawtooth', f0: f, dur, gain: gain * 0.6, attack: 0.08, lowpass: 1500, vibrato: [14, 5.2], pan, at, bus })
    tone({ type: 'sawtooth', f0: f, dur, gain: gain * 0.45, attack: 0.1, lowpass: 1200, detune: -7, vibrato: [14, 4.8], pan, at, bus })
    tone({ type: 'triangle', f0: f * 0.5, dur, gain: gain * 0.3, attack: 0.12, lowpass: 800, pan, at, bus })
  }

  /** A timpani: a pitched drop with a skin-noise transient and a long boom. */
  function timpani(f: number, gain: number, at: number, bus: GainNode | null = null): void {
    tone({ type: 'sine', f0: f * 1.6, f1: f, dur: 1.4, gain, attack: 0.004, at, bus })
    noise({ dur: 0.08, gain: gain * 0.5, filter: 'lowpass', f0: 900, f1: 200, attack: 0.002, at, bus })
    tone({ type: 'triangle', f0: f * 2.2, f1: f * 1.5, dur: 0.25, gain: gain * 0.25, attack: 0.002, lowpass: 700, at, bus })
  }

  // ---- the palette --------------------------------------------------------

  function shot(kind: TowerKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.shot[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    switch (kind) {
      case TowerKind.Single: {
        // The guard tower's arrow: a whip of air falling in pitch, over a
        // short string thump. The whoosh is the sound; the string is the
        // attack that makes it read as a shot rather than wind.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.14, gain: 0.16 * g, attack: 0.008, filter: 'bandpass', f0: vary(3200), f1: 700, q: 1.6, pan: v.pan, at: t })
        tone({ type: 'triangle', f0: vary(180), f1: 90, dur: 0.07, gain: 0.12 * g, attack: 0.002, lowpass: 900, pan: v.pan, at: t })
        return
      }
      case TowerKind.Splash: {
        // The cannon: crack, sub thump, then a long falling rumble. Three
        // layers because one sweep sounds like a synth and this has to sound
        // like a barrel.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.05, gain: 0.5 * g, attack: 0.001, filter: 'highpass', f0: 1200, pan: v.pan, at: t })
        tone({ type: 'sine', f0: vary(140, 40), f1: 34, dur: 0.5, gain: 0.7 * g, attack: 0.003, pan: v.pan, at: t })
        noise({ dur: 1.1, gain: 0.3 * g, attack: 0.01, filter: 'lowpass', f0: 700, f1: 60, pan: v.pan, at: t + 0.02 })
        return
      }
      case TowerKind.Slow: {
        // The frost shrine casting: a breath of cold air with a rising glassy
        // ring over it, then two ice ticks as the bolt leaves.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.3, gain: 0.1 * g, attack: 0.05, filter: 'bandpass', f0: 1400, f1: 3200, q: 2.5, pan: v.pan, at: t })
        tone({ type: 'sine', f0: vary(1500), f1: 2300, dur: 0.32, gain: 0.07 * g, attack: 0.04, pan: v.pan, at: t })
        tone({ type: 'sine', f0: vary(4200), dur: 0.05, gain: 0.04 * g, attack: 0.002, pan: v.pan, at: t + 0.12 })
        tone({ type: 'sine', f0: vary(5100), dur: 0.05, gain: 0.03 * g, attack: 0.002, pan: v.pan, at: t + 0.19 })
        return
      }
    }
  }

  function hit(kind: TowerKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.hit[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    switch (kind) {
      case TowerKind.Single: {
        // Thwack: an arrow into hide. A wooden knock and a short flesh thud.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.04, gain: 0.32 * g, attack: 0.001, filter: 'bandpass', f0: vary(1800), q: 1.2, pan: v.pan, at: t })
        tone({ type: 'sine', f0: vary(260), f1: 110, dur: 0.09, gain: 0.22 * g, attack: 0.002, pan: v.pan, at: t })
        return
      }
      case TowerKind.Splash: {
        // The shell landing: a bigger boom than the shot, with earth thrown
        // up -- crackly debris over a rolling low tail.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.04, gain: 0.55 * g, attack: 0.001, filter: 'highpass', f0: 900, pan: v.pan, at: t })
        tone({ type: 'sine', f0: vary(95, 40), f1: 28, dur: 0.7, gain: 0.9 * g, attack: 0.003, pan: v.pan, at: t })
        noise({ dur: 1.4, gain: 0.4 * g, attack: 0.02, filter: 'lowpass', f0: 1100, f1: 70, pan: v.pan, at: t + 0.02 })
        noise({ dur: 0.5, gain: 0.14 * g, attack: 0.05, filter: 'bandpass', f0: 2600, f1: 1200, q: 0.8, pan: v.pan, at: t + 0.12 })
        return
      }
      case TowerKind.Slow: {
        // Ice taking: a shatter -- a burst of high crackle and three detuned
        // glass pings falling away.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.12, gain: 0.22 * g, attack: 0.001, filter: 'highpass', f0: 3200, pan: v.pan, at: t })
        for (let i = 0; i < 3; i++) {
          const f = vary(2200 + i * 900, 120)
          tone({ type: 'sine', f0: f, f1: f * 0.85, dur: 0.28 - i * 0.05, gain: 0.07 * g, attack: 0.002, pan: v.pan, at: t + i * 0.035 })
        }
        return
      }
    }
  }

  function death(kind: CreepArchetypeKind, x: number, z: number): void {
    if (!ctx) return
    const n = (budgets.death[kind] as Budget).take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    switch (kind) {
      case CreepArchetypeKind.Swarm: {
        // A beetle crushed: a wet squish falling in pitch and a chitin snap.
        const g = crowdGain(n, 1) * v.gain
        noise({ dur: 0.16, gain: 0.3 * g, attack: 0.004, filter: 'lowpass', f0: vary(1600), f1: 300, q: 2, pan: v.pan, at: t })
        noise({ dur: 0.02, gain: 0.25 * g, attack: 0.001, filter: 'bandpass', f0: 3000, q: 3, pan: v.pan, at: t })
        tone({ type: 'sawtooth', f0: vary(900), f1: 250, dur: 0.11, gain: 0.05 * g, attack: 0.003, lowpass: 1800, pan: v.pan, at: t + 0.01 })
        return
      }
      case CreepArchetypeKind.Runner: {
        // A hound's yelp: a formant sweep, up then down, with breath on it.
        const g = crowdGain(n, 1) * v.gain
        const f = vary(560, 150)
        tone({ type: 'sawtooth', f0: f, f1: f * 1.9, dur: 0.08, gain: 0.1 * g, attack: 0.01, lowpass: 2200, vibrato: [30, 18], pan: v.pan, at: t })
        tone({ type: 'sawtooth', f0: f * 1.9, f1: f * 0.55, dur: 0.22, gain: 0.1 * g, attack: 0.005, lowpass: 1900, vibrato: [40, 14], pan: v.pan, at: t + 0.08 })
        noise({ dur: 0.25, gain: 0.06 * g, attack: 0.02, filter: 'bandpass', f0: 1800, f1: 900, q: 1, pan: v.pan, at: t + 0.05 })
        return
      }
      case CreepArchetypeKind.Tank: {
        // An ogre going down: a chest groan with vibrato, then the ground
        // taking a very heavy thing -- sub thump and a spray of gravel.
        const g = crowdGain(n, 1) * v.gain
        const f = vary(120, 80)
        tone({ type: 'sawtooth', f0: f, f1: f * 0.55, dur: 0.6, gain: 0.2 * g, attack: 0.03, lowpass: 650, vibrato: [25, 6], pan: v.pan, at: t })
        tone({ type: 'square', f0: f * 0.5, f1: f * 0.3, dur: 0.5, gain: 0.08 * g, attack: 0.03, lowpass: 400, pan: v.pan, at: t })
        tone({ type: 'sine', f0: 70, f1: 30, dur: 0.5, gain: 0.5 * g, attack: 0.003, pan: v.pan, at: t + 0.42 })
        noise({ dur: 0.45, gain: 0.3 * g, attack: 0.004, filter: 'lowpass', f0: 500, f1: 90, pan: v.pan, at: t + 0.42 })
        noise({ dur: 0.3, gain: 0.08 * g, attack: 0.01, filter: 'bandpass', f0: 2400, f1: 1500, q: 0.7, pan: v.pan, at: t + 0.46 })
        return
      }
    }
  }

  function leak(mine: boolean, x: number, z: number): void {
    if (!ctx) return
    const n = budgets.leak.take(performance.now())
    if (n === 0) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    if (mine) {
      // The warning: a low horn blast the way the town bell went, and a
      // deep toll under it. Meant to be heard over anything.
      horn(pitch(ROOT, -5), 0.7, 0.24 * v.gain, v.pan * 0.5, t)
      horn(pitch(ROOT, -8), 0.9, 0.2 * v.gain, v.pan * 0.5, t + 0.35)
      bell(pitch(ROOT, -12), 1.8, 0.35 * v.gain, v.pan * 0.5, t + 0.05)
    } else {
      // Theirs: a short brass stab and a bright chime, rising. Good news.
      horn(pitch(ROOT, 12), 0.35, 0.16 * v.gain, v.pan * 0.5, t)
      bell(pitch(ROOT, 31), 0.9, 0.18 * v.gain, v.pan * 0.5, t + 0.18)
    }
  }

  function build(kind: TowerKind, x: number, z: number, mine: boolean): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const g = (mine ? 1 : 0.4) * v.gain
    const t = ctx.currentTime
    // The placement thud first -- stone set on earth, with dust -- then
    // three hammer blows, each on its own note, as the masons close.
    tone({ type: 'sine', f0: 110, f1: 45, dur: 0.35, gain: 0.5 * g, attack: 0.004, pan: v.pan, at: t })
    noise({ dur: 0.4, gain: 0.18 * g, attack: 0.01, filter: 'lowpass', f0: 800, f1: 150, pan: v.pan, at: t })
    for (let i = 0; i < 3; i++) {
      const at = t + 0.16 + i * 0.13
      const f = vary(1400 + i * 260, 90)
      noise({ dur: 0.05, gain: 0.3 * g, attack: 0.001, filter: 'bandpass', f0: f, q: 2.5, pan: v.pan, at })
      tone({ type: 'triangle', f0: f * 0.5, f1: f * 0.4, dur: 0.08, gain: 0.08 * g, attack: 0.001, pan: v.pan, at })
      tone({ type: 'sine', f0: 190, f1: 120, dur: 0.07, gain: 0.14 * g, attack: 0.002, pan: v.pan, at })
    }
    if (kind === TowerKind.Splash) {
      // Iron: the barrel dropped into its cradle.
      tone({ type: 'square', f0: vary(210), f1: 150, dur: 0.3, gain: 0.08 * g, attack: 0.003, lowpass: 1200, pan: v.pan, at: t + 0.55 })
      bell(vary(620), 0.5, 0.06 * g, v.pan, t + 0.55)
    } else if (kind === TowerKind.Slow) {
      // Ice: the crystal seated, with a breath of frost.
      noise({ dur: 0.5, gain: 0.08 * g, attack: 0.1, filter: 'bandpass', f0: 1200, f1: 3400, q: 2, pan: v.pan, at: t + 0.5 })
      bell(vary(1900), 0.9, 0.06 * g, v.pan, t + 0.6)
    }
  }

  function upgrade(x: number, z: number, mine: boolean): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const g = (mine ? 1 : 0.4) * v.gain
    const t = ctx.currentTime
    // The research-complete chime: a bright bell over a rising fifth, with
    // a hammer on the tower under it so it still reads as building.
    noise({ dur: 0.05, gain: 0.22 * g, attack: 0.001, filter: 'bandpass', f0: vary(1700), q: 2.5, pan: v.pan, at: t })
    bell(pitch(ROOT * 4, 0), 1.3, 0.14 * g, v.pan, t + 0.05)
    bell(pitch(ROOT * 4, 7), 1.5, 0.12 * g, v.pan, t + 0.2)
    bell(pitch(ROOT * 8, 0), 1.2, 0.07 * g, v.pan, t + 0.35)
  }

  function sell(x: number, z: number): void {
    if (!ctx) return
    const v = voiceAt(x, z)
    const t = ctx.currentTime
    // Stone coming down in a slide of rubble, then the refund counted out.
    noise({ dur: 0.5, gain: 0.28 * v.gain, attack: 0.02, filter: 'lowpass', f0: 900, f1: 120, pan: v.pan, at: t })
    tone({ type: 'sine', f0: 90, f1: 40, dur: 0.35, gain: 0.3 * v.gain, attack: 0.005, pan: v.pan, at: t + 0.05 })
    coins(t + 0.3, 4, 0.8 * v.gain, v.pan)
  }

  function coins(t: number, count: number, gain: number, pan: number): void {
    // Gold clinking: small bells with a metallic tick on each, a little
    // faster and higher as the pile grows.
    for (let i = 0; i < count; i++) {
      const at = t + i * (0.07 - i * 0.006)
      bell(vary(2700 + i * 150, 140), 0.32, 0.055 * gain, pan, at)
      noise({ dur: 0.015, gain: 0.08 * gain, attack: 0.001, filter: 'highpass', f0: 5000, pan, at })
    }
  }

  function send(): void {
    if (!ctx || budgets.send.take(performance.now()) === 0) return
    const t = ctx.currentTime
    // The wave leaving: a whoosh out to the right and a low drum under it,
    // like a gate opening on a war camp.
    noise({ dur: 0.36, gain: 0.16, attack: 0.04, filter: 'bandpass', f0: 300, f1: 2600, q: 1.1, pan: 0.45, at: t })
    tone({ type: 'sine', f0: 80, f1: 45, dur: 0.3, gain: 0.22, attack: 0.004, pan: 0.2, at: t })
    noise({ dur: 0.06, gain: 0.1, attack: 0.001, filter: 'lowpass', f0: 800, pan: 0.2, at: t })
  }

  function income(): void {
    if (!ctx) return
    coins(ctx.currentTime, 3, 0.9, 0)
  }

  function tierUnlock(): void {
    if (!ctx) return
    const t = ctx.currentTime
    // A brass fanfare in the human style: fourth, fifth, octave, held, with a
    // timpani under the last. The one moment the score is allowed to be
    // heroic.
    const notes: readonly [number, number, number][] = [
      [5, 0, 0.3],
      [7, 0.28, 0.3],
      [12, 0.56, 1.4],
    ]
    for (const [s, dt, dur] of notes) {
      horn(pitch(ROOT * 2, s), dur, 0.22, -0.15, t + dt)
      horn(pitch(ROOT, s), dur, 0.14, 0.15, t + dt)
    }
    timpani(pitch(ROOT * 0.5, 0), 0.5, t + 0.56)
  }

  function select(): void {
    if (!ctx) return
    // A unit acknowledged: a wooden tock with a little ring.
    noise({ dur: 0.03, gain: 0.14, attack: 0.001, filter: 'bandpass', f0: 1500, q: 2, at: ctx.currentTime })
    tone({ type: 'triangle', f0: 880, f1: 760, dur: 0.09, gain: 0.05, attack: 0.002, at: ctx.currentTime })
  }

  function click(): void {
    if (!ctx) return
    // The button: a soft wooden click, lower than the select.
    noise({ dur: 0.025, gain: 0.16, attack: 0.001, filter: 'bandpass', f0: 900, q: 1.8, at: ctx.currentTime })
    tone({ type: 'sine', f0: 420, f1: 360, dur: 0.06, gain: 0.07, attack: 0.002, at: ctx.currentTime })
  }

  function refused(): void {
    if (!ctx || budgets.refused.take(performance.now()) === 0) return
    const t = ctx.currentTime
    // The error: a dull double knock, the sound of a door that will not open.
    for (let i = 0; i < 2; i++) {
      noise({ dur: 0.04, gain: 0.18, attack: 0.001, filter: 'lowpass', f0: 700, at: t + i * 0.09 })
      tone({ type: 'square', f0: 150, f1: 130, dur: 0.09, gain: 0.06, attack: 0.003, lowpass: 600, at: t + i * 0.09 })
    }
  }

  function matchEnd(won: boolean): void {
    if (!ctx) return
    const t = ctx.currentTime
    if (won) {
      // Victory: a major chord in the brass, swelling, a timpani roll under it.
      for (const [s, dt] of [[0, 0], [4, 0.1], [7, 0.2], [12, 0.3], [16, 0.4]] as const) {
        horn(pitch(ROOT * 2, s), 3.2, 0.16, (s - 8) / 20, t + dt)
      }
      for (let i = 0; i < 8; i++) timpani(pitch(ROOT * 0.5, 0), 0.22 + i * 0.04, t + i * 0.11)
      timpani(pitch(ROOT * 0.5, 0), 0.6, t + 0.95)
    } else {
      // Defeat: a low minor chord and a horn falling a fifth, then a single toll.
      for (const [s, dt] of [[0, 0], [3, 0.08], [7, 0.16], [12, 0.24]] as const) {
        horn(pitch(ROOT, s), 3.4, 0.14, (s - 6) / 20, t + dt)
      }
      horn(pitch(ROOT * 2, 7), 1.0, 0.16, 0, t + 0.6)
      horn(pitch(ROOT * 2, 0), 1.8, 0.16, 0, t + 1.5)
      bell(pitch(ROOT, -12), 3, 0.3, 0, t + 1.6)
    }
  }

  // ---- the bed ------------------------------------------------------------
  //
  // Strings: six detuned saws in two octaves under a slow lowpass. A choir:
  // two saws through a pair of formant filters on an "ah". Both glide to the
  // next chord every two bars. Over them, scheduled a bar ahead of the clock
  // from `update()`: a harp arpeggiating the chord, a horn carrying the
  // phrase every other turn of the cycle, timpani on the changes when the
  // field is busy.

  let stringVoices: OscillatorNode[] = []
  let choirVoices: OscillatorNode[] = []
  let stringFilter: BiquadFilterNode | null = null
  let stringGain: GainNode | null = null
  let choirGain: GainNode | null = null
  let chordIndex = 0
  let beatIndex = 0
  let nextBeatAt = 0
  let motifStep = 0
  let motifRemaining = 0
  let motifCycle = 0
  let nextBirdAt = 0
  let windGain: GainNode | null = null

  function startBed(): void {
    if (!ctx || !music) return
    const c = ctx
    // Strings.
    stringGain = c.createGain()
    stringGain.gain.value = 0.0001
    stringFilter = c.createBiquadFilter()
    stringFilter.type = 'lowpass'
    stringFilter.frequency.value = 900
    stringFilter.Q.value = 1.1
    stringGain.connect(stringFilter)
    stringFilter.connect(music)
    const swell = c.createOscillator()
    swell.frequency.value = 0.045
    const swellDepth = c.createGain()
    swellDepth.gain.value = 260
    swell.connect(swellDepth)
    swellDepth.connect(stringFilter.frequency)
    swell.start()

    const chord = CHORDS[0] as readonly number[]
    stringVoices = []
    chord.forEach((s, i) => {
      // Two voices per chord tone, detuned against each other: a section,
      // not a soloist. The bass gets one, an octave down.
      const voices = i === 0 ? 1 : 2
      for (let k = 0; k < voices; k++) {
        const o = c.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = pitch(i === 0 ? ROOT * 0.5 : ROOT, s)
        o.detune.value = (k === 0 ? 1 : -1) * (5 + i * 1.5)
        const g = c.createGain()
        g.gain.value = i === 0 ? 0.5 : 0.28
        o.connect(g)
        g.connect(stringGain as GainNode)
        o.start()
        stringVoices.push(o)
      }
    })
    stringGain.gain.setTargetAtTime(0.11, c.currentTime, 3)

    // Choir: saws through two formant bandpasses -- an open "ah" -- swelling
    // slowly, an octave above the strings' middle.
    choirGain = c.createGain()
    choirGain.gain.value = 0.0001
    const f1 = c.createBiquadFilter()
    f1.type = 'bandpass'
    f1.frequency.value = 720
    f1.Q.value = 6
    const f2 = c.createBiquadFilter()
    f2.type = 'bandpass'
    f2.frequency.value = 1180
    f2.Q.value = 8
    const mix = c.createGain()
    mix.gain.value = 1
    f1.connect(mix)
    f2.connect(mix)
    mix.connect(choirGain)
    choirGain.connect(music)
    const breath = c.createOscillator()
    breath.frequency.value = 0.09
    const breathDepth = c.createGain()
    breathDepth.gain.value = 0.05
    breath.connect(breathDepth)
    breathDepth.connect(choirGain.gain)
    breath.start()
    choirVoices = []
    for (const idx of [2, 3]) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = pitch(ROOT, chord[idx] as number)
      const vib = c.createOscillator()
      vib.frequency.value = 5.5
      const vibDepth = c.createGain()
      vibDepth.gain.value = 9
      vib.connect(vibDepth)
      vibDepth.connect(o.detune)
      vib.start()
      o.connect(f1)
      o.connect(f2)
      o.start()
      choirVoices.push(o)
    }
    choirGain.gain.setTargetAtTime(0.09, c.currentTime, 6)

    nextBeatAt = c.currentTime + 1.0
    beatIndex = 0
    chordIndex = 0
    motifStep = 0
    motifRemaining = 0
    motifCycle = 0
  }

  function startAmbience(): void {
    if (!ctx || !ambience || !noiseBuffer) return
    const c = ctx
    // Wind: low noise under a slowly moving lowpass, and a very low rumble
    // under that -- the room tone every Warcraft map has.
    const src = c.createBufferSource()
    src.buffer = noiseBuffer
    src.loop = true
    const f = c.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.value = 340
    f.Q.value = 0.6
    windGain = c.createGain()
    windGain.gain.value = 0.0001
    src.connect(f)
    f.connect(windGain)
    windGain.connect(ambience)
    const lfo = c.createOscillator()
    lfo.frequency.value = 0.05
    const lfoGain = c.createGain()
    lfoGain.gain.value = 160
    lfo.connect(lfoGain)
    lfoGain.connect(f.frequency)
    lfo.start()
    src.start()
    windGain.gain.setTargetAtTime(0.14, c.currentTime, 3)
    nextBirdAt = c.currentTime + 2
  }

  function bird(at: number): void {
    if (!ctx || !ambience) return
    // Two or three quick chirps with a warble, far off to one side.
    const pan = (rnd() - 0.5) * 1.6
    const base = 2300 + rnd() * 1400
    const n = 2 + Math.floor(rnd() * 2)
    for (let i = 0; i < n; i++) {
      tone({ type: 'sine', f0: base, f1: base * 1.3, dur: 0.1, gain: 0.05, attack: 0.01, vibrato: [60, 30], pan, bus: ambience, at: at + i * 0.14 })
    }
  }

  /** One beat of the score, scheduled at `at`. */
  function beat(at: number): void {
    if (!ctx || !music) return
    const chord = CHORDS[chordIndex] as readonly number[]
    const beatInChord = beatIndex % BEATS_PER_CHORD

    // The change: glide strings and choir, and a timpani when it is a fight.
    if (beatInChord === 0) {
      let v = 0
      chord.forEach((s, i) => {
        const voices = i === 0 ? 1 : 2
        for (let k = 0; k < voices; k++) {
          const o = stringVoices[v++]
          if (o) o.frequency.setTargetAtTime(pitch(i === 0 ? ROOT * 0.5 : ROOT, s), at, 0.5)
        }
      })
      choirVoices.forEach((o, i) => o.frequency.setTargetAtTime(pitch(ROOT, chord[i + 2] as number), at, 0.7))
      if (intensityNow > 0.3) timpani(pitch(ROOT * 0.5, chord[0] as number), 0.25 + intensityNow * 0.3, at, music)
    }

    // Harp: the chord, up and down, one note a beat, with the odd rest so it
    // breathes. Louder over a quiet field, where it is the foreground.
    if (rnd() > 0.18) {
      const s = arpeggio(chord, beatInChord)
      const f = pitch(ROOT * 2, s)
      const g = 0.11 * (1 - intensityNow * 0.5)
      tone({ type: 'triangle', f0: f, dur: 1.3, gain: g, attack: 0.003, lowpass: 3200, pan: (rnd() - 0.5) * 0.7, bus: music, at })
      tone({ type: 'sine', f0: f * 2, dur: 0.6, gain: g * 0.35, attack: 0.003, bus: music, at })
      noise({ dur: 0.012, gain: g * 0.5, attack: 0.001, filter: 'highpass', f0: 3000, bus: music, at })
    }

    // The horn phrase, every other turn of the cycle, quieter under a fight
    // where the drums have the floor.
    if (motifCycle % 2 === 1) {
      if (motifRemaining <= 0 && motifStep < MOTIF.length) {
        const [s, beats] = MOTIF[motifStep] as readonly [number | null, number]
        if (s !== null) horn(pitch(ROOT * 2, s), beats * BEAT * 0.95, 0.09 * (1 - intensityNow * 0.4), 0.1, at, music)
        motifRemaining = beats
        motifStep += 1
      }
      motifRemaining -= 1
    }

    // War drums under pressure: a low drum on the strong beats, a rim on the
    // weak ones, building with the field.
    if (intensityNow > 0.2) {
      const g = (intensityNow - 0.2) * 0.35
      if (beatIndex % 2 === 0) {
        tone({ type: 'sine', f0: 100, f1: 40, dur: 0.3, gain: g, attack: 0.003, bus: music, at })
        noise({ dur: 0.05, gain: g * 0.6, attack: 0.001, filter: 'lowpass', f0: 700, bus: music, at })
      } else {
        noise({ dur: 0.035, gain: g * 0.35, attack: 0.001, filter: 'bandpass', f0: 2200, q: 2, bus: music, at })
      }
    }

    beatIndex += 1
    if (beatIndex % BEATS_PER_CHORD === 0) {
      chordIndex = (chordIndex + 1) % CHORDS.length
      if (chordIndex === 0) {
        motifCycle += 1
        motifStep = 0
        motifRemaining = 0
      }
    }
  }

  function update(): void {
    if (!ctx || !music) return
    const now = ctx.currentTime
    const ahead = now + BEAT
    while (nextBeatAt < ahead) {
      beat(nextBeatAt)
      nextBeatAt += BEAT
    }
    while (nextBirdAt < ahead) {
      if (intensityNow < 0.3) bird(nextBirdAt)
      nextBirdAt += 3 + rnd() * 7
    }
    // The strings open up and the choir steps back as the fight builds.
    if (stringFilter) stringFilter.frequency.setTargetAtTime(800 + intensityNow * 1400, now, 1.5)
    if (choirGain) choirGain.gain.setTargetAtTime(0.09 * (1 - intensityNow * 0.6), now, 2)
    if (windGain) windGain.gain.setTargetAtTime(0.14 - intensityNow * 0.08, now, 2)
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
