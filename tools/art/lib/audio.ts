import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import Ajv from 'ajv'
import { REPO_ROOT } from './spec'
import { SOUNDS, BUILD } from './paths'

/**
 * The audio half of the factory: a small deterministic synthesiser that
 * renders a sound spec to 48 kHz 24-bit WAV, and the ffmpeg pipeline that
 * measures, normalises and delivers it as Opus-in-WebM plus MP3.
 *
 * The synthesiser is deliberately simple -- oscillators, one biquad, an
 * ADSR, a soft clipper, a short synthesised reverb -- because it exists so
 * every event has a sound from day one, not to replace audio.ts's live
 * synthesis or a recorded library. Everything is seeded from the id.
 */

export const SAMPLE_RATE = 48000
export const SOUND_SCHEMA = join(REPO_ROOT, 'art', 'sound.schema.json')
export const SOUND_BUILD = join(BUILD, 'sfx')

export const TARGETS = {
  sfx: { lufs: -16, peak: -1.0, maxSeconds: 2.0 },
  stinger: { lufs: -16, peak: -1.0, maxSeconds: 4.0 },
}

export interface Layer {
  wave: 'sine' | 'triangle' | 'saw' | 'square' | 'noise'
  freq: number; freq_end: number | null; glide: 'linear' | 'exp'
  attack: number; decay: number; sustain: number; hold: number; release: number
  gain: number; delay: number
  filter: { type: 'lowpass' | 'highpass' | 'bandpass'; freq: number; freq_end: number | null; q: number } | null
  vibrato: [number, number] | null
  pan: number; drive: number
}

export interface SoundSpec {
  id: string; event: string; variant: number; duration: number; stereo: boolean
  layers: Layer[]; reverb: number
  source: { kind: string; licence: string; author: string; url: string; attribution: string; approved_by: string; notes: string }
}

let validator: ((d: unknown) => boolean) & { errors?: unknown[] | null } | null = null

export function listSoundIds(): string[] {
  if (!existsSync(SOUNDS)) return []
  return readdirSync(SOUNDS).filter((f) => f.endsWith('.yaml')).map((f) => basename(f, '.yaml')).sort()
}

export function loadSoundSpec(id: string): { spec: SoundSpec; problems: string[]; hash: string } {
  const path = join(SOUNDS, `${id}.yaml`)
  if (!existsSync(path)) throw new Error(`no sound spec ${path}`)
  const raw = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>
  if (!validator) {
    const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false })
    validator = ajv.compile(JSON.parse(readFileSync(SOUND_SCHEMA, 'utf8')) as object)
  }
  const ok = validator(raw)
  const problems = ok ? [] : (validator.errors as { instancePath: string; message?: string }[]).map((e) => `${e.instancePath || '/'}: ${e.message ?? ''}`)
  if (raw['id'] !== id) problems.push(`/id: file is ${id}.yaml but id says ${String(raw['id'])}`)
  const hash = createHash('sha256').update(JSON.stringify(raw, Object.keys(raw).sort())).digest('hex').slice(0, 16)
  return { spec: raw as unknown as SoundSpec, problems, hash }
}

// ---- synthesis --------------------------------------------------------------

/** mulberry32, seeded from the id: the same noise every render. */
function rng(seed: string): () => number {
  let a = parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0
  set(type: string, f: number, q: number): void {
    const w = (2 * Math.PI * Math.min(f, SAMPLE_RATE * 0.49)) / SAMPLE_RATE
    const cs = Math.cos(w), sn = Math.sin(w), alpha = sn / (2 * q)
    let b0: number, b1: number, b2: number
    const a0 = 1 + alpha, a1 = -2 * cs, a2 = 1 - alpha
    if (type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2 }
    else if (type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2 }
    else { b0 = alpha; b1 = 0; b2 = -alpha }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}

function envelope(t: number, l: Layer): number {
  if (t < 0) return 0
  if (t < l.attack) return l.attack > 0 ? t / l.attack : 1
  t -= l.attack
  if (t < l.decay) return 1 - (1 - l.sustain) * (t / l.decay)
  t -= l.decay
  if (t < l.hold) return l.sustain
  t -= l.hold
  if (t < l.release) return l.sustain * (1 - t / l.release)
  return 0
}

export function synthesise(spec: SoundSpec): { left: Float32Array; right: Float32Array } {
  const n = Math.round(spec.duration * SAMPLE_RATE)
  const left = new Float32Array(n)
  const right = new Float32Array(n)
  spec.layers.forEach((l, li) => {
    const noise = rng(`${spec.id}:${li}`)
    const filter = l.filter ? new Biquad() : null
    let phase = 0
    const len = l.attack + l.decay + l.hold + l.release
    const gl = l.pan <= 0 ? 1 : 1 - l.pan
    const gr = l.pan >= 0 ? 1 : 1 + l.pan
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE - l.delay
      if (t < 0 || t > len) continue
      const u = len > 0 ? Math.min(1, t / len) : 1
      let f = l.freq
      if (l.freq_end !== null) f = l.glide === 'exp' ? l.freq * Math.pow(l.freq_end / l.freq, u) : l.freq + (l.freq_end - l.freq) * u
      if (l.vibrato) f *= Math.pow(2, (l.vibrato[1] / 1200) * Math.sin(2 * Math.PI * l.vibrato[0] * t))
      phase += f / SAMPLE_RATE
      const p = phase - Math.floor(phase)
      let s: number
      switch (l.wave) {
        case 'sine': s = Math.sin(2 * Math.PI * p); break
        case 'triangle': s = 4 * Math.abs(p - 0.5) - 1; break
        case 'saw': s = 2 * p - 1; break
        case 'square': s = p < 0.5 ? 1 : -1; break
        default: s = noise() * 2 - 1
      }
      if (filter && l.filter) {
        const ff = l.filter.freq_end !== null ? l.filter.freq * Math.pow(l.filter.freq_end / l.filter.freq, u) : l.filter.freq
        if (i % 32 === 0) filter.set(l.filter.type, ff, l.filter.q)
        s = filter.run(s)
      }
      if (l.drive > 0) s = Math.tanh(s * (1 + l.drive * 6)) / Math.tanh(1 + l.drive * 6)
      s *= envelope(t, l) * l.gain
      left[i] = (left[i] ?? 0) + s * gl
      right[i] = (right[i] ?? 0) + s * gr
    }
  })
  if (spec.reverb > 0) {
    // A short hall: four feedback comb filters, seeded delays, mixed in.
    const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => ({ buf: new Float32Array(Math.round(d * SAMPLE_RATE)), i: 0 }))
    for (const ch of [left, right]) {
      const dry = Float32Array.from(ch)
      for (let i = 0; i < n; i++) {
        let wet = 0
        for (const c of combs) {
          const y = c.buf[c.i] ?? 0
          c.buf[c.i] = (dry[i] ?? 0) + y * 0.72
          c.i = (c.i + 1) % c.buf.length
          wet += y
        }
        ch[i] = (dry[i] ?? 0) * (1 - spec.reverb * 0.5) + wet * spec.reverb * 0.25
      }
      for (const c of combs) { c.buf.fill(0); c.i = 0 }
    }
  }
  // Soft master clip so a hot layer stack cannot exceed ±1 before loudnorm.
  for (const ch of [left, right]) for (let i = 0; i < n; i++) ch[i] = Math.tanh((ch[i] ?? 0) * 1.2) / Math.tanh(1.2)
  return { left, right }
}

/** 24-bit PCM WAV. */
export function writeWav(path: string, left: Float32Array, right: Float32Array | null): void {
  const channels = right ? 2 : 1
  const n = left.length
  const dataBytes = n * channels * 3
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * channels * 3, 28); buf.writeUInt16LE(channels * 3, 32); buf.writeUInt16LE(24, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40)
  let o = 44
  const put = (v: number) => { const s = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388607))); buf.writeIntLE(s, o, 3); o += 3 }
  for (let i = 0; i < n; i++) { put(left[i] ?? 0); if (right) put(right[i] ?? 0) }
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, buf)
}

// ---- ffmpeg -----------------------------------------------------------------

export function ffmpeg(args: string[]): { ok: boolean; out: string } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

export interface Loudness { lufs: number; peak: number; seconds: number; measure: 'integrated' | 'momentary' }

/**
 * EBU R128 loudness and true peak. A sound shorter than a second is
 * measured as the loudest MOMENTARY reading (400 ms window) rather than
 * integrated: R128's gate swallows a 300 ms click entirely (I: -70), and
 * the momentary window never fills on a file shorter than itself -- so the
 * file is padded with half a second of silence for the measurement only.
 */
export function measure(path: string): Loudness {
  const r = ffmpeg(['-i', path, '-af', 'apad=pad_dur=0.5,ebur128=peak=true', '-f', 'null', '-'])
  const i = /I:\s+(-?[\d.]+) LUFS/.exec(r.out)
  const p = /Peak:\s+(-?[\d.]+) dBFS/.exec(r.out)
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.out)
  const seconds = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0
  const momentary = [...r.out.matchAll(/\bM:\s*(-?[\d.]+)/g)].map((x) => Number(x[1])).filter((x) => Number.isFinite(x) && x > -100)
  const integrated = i ? Number(i[1]) : NaN
  const useIntegrated = seconds >= 1.0 && Number.isFinite(integrated) && integrated > -60
  const lufs = useIntegrated ? integrated : momentary.length ? Math.max(...momentary) : NaN
  return { lufs, peak: p ? Number(p[1]) : NaN, seconds, measure: useIntegrated ? 'integrated' : 'momentary' }
}

/** Trim silence, normalise to the target, deliver webm+mp3. Returns the measured result. */
export function deliver(wav: string, outBase: string, target: { lufs: number; peak: number }, stereo: boolean): { webm: string; mp3: string; normalised: string; measured: Loudness; log: string } {
  const trimmed = `${outBase}.trim.wav`
  const norm = `${outBase}.norm.wav`
  let log = ''
  const t = ffmpeg(['-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.005,areverse,silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.005,areverse,afade=t=in:d=0.005,areverse,afade=t=in:d=0.005,areverse', trimmed])
  log += t.out
  // loudnorm in one pass with a linear gain is enough for a short SFX: the
  // two-pass mode exists for programme material and its true-peak limiter
  // is what the -1 dBTP ceiling relies on.
  const first = measure(trimmed)
  const gainDb = target.lufs - first.lufs
  // The limiter caps SAMPLE peaks; the TRUE peak between samples can sit
  // about a decibel higher, so the cap is set 1.2 dB under the ceiling.
  const n = ffmpeg(['-i', trimmed, '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${Math.pow(10, (target.peak - 1.2) / 20).toFixed(4)}:attack=0.5:release=15:level=false`, '-ar', String(SAMPLE_RATE), '-ac', stereo ? '2' : '1', '-c:a', 'pcm_s24le', norm])
  log += n.out
  // The limiter caps sample peaks; a sharp transient can still leave a TRUE
  // peak above the ceiling (measured: -0.6 dBTP on one bolt with the cap at
  // -2.2 dBFS). Measure, and if it overshoots, pull the whole file down by
  // the excess plus 0.1 dB. That costs the same fraction of loudness, which is
  // inside the ±1.5 LU tolerance for anything that got this far.
  const check = measure(norm)
  if (Number.isFinite(check.peak) && check.peak > target.peak) {
    const fixed = `${outBase}.norm2.wav`
    const f = ffmpeg(['-i', norm, '-af', `volume=${(target.peak - check.peak - 0.1).toFixed(2)}dB`, '-c:a', 'pcm_s24le', fixed])
    log += f.out
    if (f.ok) {
      ffmpeg(['-i', fixed, '-c:a', 'pcm_s24le', norm])
    }
  }
  const webm = `${outBase}.webm`
  const mp3 = `${outBase}.mp3`
  const w = ffmpeg(['-i', norm, '-c:a', 'libopus', '-b:a', stereo ? '96k' : '64k', '-vbr', 'on', '-application', 'audio', webm])
  const m = ffmpeg(['-i', norm, '-c:a', 'libmp3lame', '-b:a', '128k', '-write_xing', '0', mp3])
  log += w.out + m.out
  return { webm, mp3, normalised: norm, measured: measure(norm), log }
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}
