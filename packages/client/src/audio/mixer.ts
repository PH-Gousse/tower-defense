/**
 * The parts of the sound system that are arithmetic rather than Web Audio,
 * kept apart so they can be tested in node, where there is no AudioContext.
 *
 * Two problems live here. The first is COUNT: a flood puts hundreds of shots
 * and dozens of deaths into a single second, and a sound per event would be
 * white noise and a hundred oscillators. `Budget` turns that into a few
 * sounds a second whose loudness says how many events they stand for. The
 * second is PLACE: the camera is fixed and the board is wide, so a sound is
 * panned by where it happens relative to what the camera is looking at, and
 * softened as it leaves the frame.
 *
 * The music's material is here too -- the chord cycle, the horn's phrase --
 * because whether an arpeggio can clash with the chord under it is a fact
 * about numbers, and worth a test.
 */

/**
 * A rate limit that remembers what it refused.
 *
 * `take(now)` admits an event if the last admitted one is at least `minGapMs`
 * behind it, and returns how many events -- this one included -- the last
 * admission stands for, so the caller can play one sound a little louder for
 * a crowd rather than a hundred sounds at once. Returns 0 when refused.
 *
 * `perSecond` caps admissions over any rolling second as well, because a
 * minimum gap alone lets a steady stream through at exactly the gap.
 */
export class Budget {
  private lastAt = -Infinity
  private pending = 0
  private readonly stamps: number[]
  private head = 0
  private size = 0

  constructor(
    private readonly minGapMs: number,
    perSecond: number,
  ) {
    this.stamps = new Array<number>(Math.max(1, perSecond)).fill(-Infinity)
  }

  take(nowMs: number): number {
    this.pending += 1
    if (nowMs - this.lastAt < this.minGapMs) return 0
    // Rolling second: the slot about to be reused holds the oldest admission.
    const oldest = this.stamps[this.head] as number
    if (this.size === this.stamps.length && nowMs - oldest < 1000) return 0
    this.stamps[this.head] = nowMs
    this.head = (this.head + 1) % this.stamps.length
    if (this.size < this.stamps.length) this.size += 1
    this.lastAt = nowMs
    const n = this.pending
    this.pending = 0
    return n
  }
}

/** Gain for a sound standing for `count` events: louder for a crowd, gently. */
export function crowdGain(count: number, base: number, ceiling = 2.5): number {
  if (count <= 1) return base
  // Each doubling adds a fixed step; ten events is about twice one.
  const g = base * (1 + Math.log2(count) * 0.3)
  const cap = base * ceiling
  return g > cap ? cap : g
}

export interface Placed {
  /** Stereo pan, -1 (left) to 1 (right). */
  readonly pan: number
  /** Gain multiplier, 1 at the centre of the frame, fading outside it. */
  readonly gain: number
}

/**
 * Where a world position sits relative to the camera's target.
 *
 * `halfWidth` is half the ground width the frame shows, so a sound at the
 * frame's edge is fully panned and one a full frame-width outside it is
 * nearly silent. Depth along the lane is not panned -- the camera has no yaw
 * -- but it does attenuate, more gently, so the far end of the board is
 * quieter than the near end without going away.
 */
export function place(
  x: number,
  z: number,
  targetX: number,
  targetZ: number,
  halfWidth: number,
  out: { pan: number; gain: number },
): Placed {
  const w = halfWidth > 0.01 ? halfWidth : 0.01
  const dx = (x - targetX) / w
  const dz = (z - targetZ) / (w * 1.5)
  let pan = dx
  if (pan > 1) pan = 1
  if (pan < -1) pan = -1
  const off = Math.sqrt(dx * dx + dz * dz)
  // Full inside the frame, then a linear fade to a floor over the next frame.
  let gain = off <= 1 ? 1 : 1 - (off - 1) * 0.8
  if (gain < 0.08) gain = 0.08
  out.pan = pan
  out.gain = gain
  return out
}

/**
 * The bed's chord cycle, as semitones above the key, one chord per two bars.
 *
 * A minor, and the progression that carries most of the era's fantasy scores:
 * i - VI - VII - i, then iv - VI - V - i, the V borrowed from the harmonic
 * minor so the phrase leans home. Voiced low to high, root doubled at the
 * top, the way a string section would lay it.
 */
export const CHORDS: readonly (readonly number[])[] = [
  [0, 7, 12, 15, 19], // i     A C E
  [-4, 3, 8, 12, 15], // VI    F A C
  [-2, 5, 10, 14, 17], // VII  G B D
  [0, 7, 12, 15, 19], // i
  [-7, 0, 5, 8, 12], // iv     D A D F A
  [-4, 3, 8, 12, 15], // VI
  [-5, 2, 7, 11, 14], // V     E B E G# B
  [0, 7, 12, 15, 19], // i
]

/** Beats per minute. Slow: a march for a funeral, not a parade. */
export const BPM = 66
/** Beats per chord. Two bars of four. */
export const BEATS_PER_CHORD = 8

/**
 * The horn's phrase, as [semitones above the key, beats], over one full turn
 * of the cycle. Aeolian, stepwise, ending on the fifth so it never resolves:
 * the line under every long march across a Warcraft map. A null pitch is a
 * rest.
 */
export const MOTIF: readonly (readonly [number | null, number])[] = [
  [7, 2], [5, 1], [3, 1], [5, 2], [7, 2],
  [8, 2], [7, 1], [5, 1], [3, 3], [null, 1],
  [0, 2], [3, 1], [5, 1], [7, 2], [3, 2],
  [2, 2], [3, 1], [5, 1], [7, 3], [null, 1],
]

/**
 * The harp's note for the `step`th arpeggio beat of `chord`: up through the
 * chord tones and back down, so it is always consonant with the pad. Returns
 * semitones above the key.
 */
export function arpeggio(chord: readonly number[], step: number): number {
  const n = chord.length
  const period = 2 * (n - 1)
  const i = step % period
  const idx = i < n ? i : period - i
  return chord[idx] as number
}

/** Frequency of `semitones` above a root frequency. */
export function pitch(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12)
}

/**
 * How busy the field is, 0..1, from the creep count. The music and the
 * ambience follow this: quiet birds over an empty field, a drum under a
 * flood. Saturates around a hundred creeps, which is a lane under pressure
 * rather than the thousands a late mirror reaches.
 */
export function intensity(creeps: number): number {
  const v = creeps / 100
  return v > 1 ? 1 : v < 0 ? 0 : v
}
