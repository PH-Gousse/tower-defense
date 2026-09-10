import { describe, it, expect } from 'vitest'
import { Budget, crowdGain, place, pitch, intensity, arpeggio, CHORDS, MOTIF, BPM, BEATS_PER_CHORD } from '../src/audio/mixer'

/**
 * The arithmetic under the sound system. Web Audio itself cannot run in node,
 * so what is pinned is what decides whether a flood is a roar or a hundred
 * clicks, and whether a sound comes from where the eye is looking.
 */

describe('Budget', () => {
  it('admits the first event and refuses those inside the gap', () => {
    const b = new Budget(100, 100)
    expect(b.take(0)).toBe(1)
    expect(b.take(50)).toBe(0)
    expect(b.take(99)).toBe(0)
    expect(b.take(100)).toBeGreaterThan(0)
  })

  it('reports how many events an admission stands for', () => {
    // Three refused, then one admitted: that sound is four events.
    const b = new Budget(100, 100)
    b.take(0)
    b.take(10)
    b.take(20)
    b.take(30)
    expect(b.take(100)).toBe(4)
    // And the count resets.
    expect(b.take(200)).toBe(1)
  })

  it('caps admissions over a rolling second even when the gap allows them', () => {
    const b = new Budget(10, 3)
    expect(b.take(0)).toBe(1)
    expect(b.take(100)).toBe(1)
    expect(b.take(200)).toBe(1)
    expect(b.take(300)).toBe(0)
    expect(b.take(900)).toBe(0)
    // The first slot ages out at 1000ms and its pending count comes with it.
    expect(b.take(1000)).toBe(3)
  })
})

describe('crowdGain', () => {
  it('is the base for one event and grows gently with the crowd', () => {
    expect(crowdGain(1, 0.5)).toBe(0.5)
    expect(crowdGain(10, 0.5)).toBeGreaterThan(0.5)
    expect(crowdGain(10, 0.5)).toBeLessThan(1.25)
  })

  it('never exceeds the ceiling, however large the crowd', () => {
    expect(crowdGain(100000, 0.5)).toBeLessThanOrEqual(0.5 * 2.5)
  })
})

describe('place', () => {
  const out = { pan: 0, gain: 0 }

  it('pans by where the sound is relative to the camera target', () => {
    expect(place(10, 0, 10, 0, 10, out).pan).toBe(0)
    expect(place(20, 0, 10, 0, 10, out).pan).toBe(1)
    expect(place(0, 0, 10, 0, 10, out).pan).toBe(-1)
    expect(place(15, 0, 10, 0, 10, out).pan).toBeCloseTo(0.5)
  })

  it('clamps the pan and never returns a silent gain', () => {
    expect(place(500, 0, 10, 0, 10, out).pan).toBe(1)
    expect(place(500, 500, 10, 0, 10, out).gain).toBeGreaterThan(0)
  })

  it('is full inside the frame and fades outside it', () => {
    expect(place(10, 0, 10, 0, 10, out).gain).toBe(1)
    expect(place(19, 0, 10, 0, 10, out).gain).toBe(1)
    const near = place(25, 0, 10, 0, 10, out).gain
    const far = place(35, 0, 10, 0, 10, out).gain
    expect(near).toBeLessThan(1)
    expect(far).toBeLessThan(near)
  })

  it('attenuates along the lane more gently than across it', () => {
    const across = place(25, 0, 10, 0, 10, out).gain
    const along = place(10, 15, 10, 0, 10, out).gain
    expect(along).toBeGreaterThan(across)
  })
})

describe('the score', () => {
  /** A minor with the harmonic minor's raised seventh allowed: A B C D E F G G#. */
  const KEY = new Set([0, 2, 3, 5, 7, 8, 10, 11])
  const mod = (n: number) => ((n % 12) + 12) % 12

  it('doubles the frequency an octave up', () => {
    expect(pitch(220, 12)).toBeCloseTo(440)
    expect(pitch(220, 0)).toBe(220)
  })

  it('keeps every chord in the key, voiced low to high', () => {
    for (const chord of CHORDS) {
      for (const tone of chord) expect(KEY.has(mod(tone)), `tone ${tone}`).toBe(true)
      for (let i = 1; i < chord.length; i++) expect(chord[i]!).toBeGreaterThan(chord[i - 1]!)
    }
  })

  it('arpeggiates only chord tones, so the harp can never clash with the pad', () => {
    for (const chord of CHORDS) {
      for (let step = 0; step < BEATS_PER_CHORD * 3; step++) {
        expect(chord).toContain(arpeggio(chord, step))
      }
    }
  })

  it('runs the arpeggio up and back down rather than jumping', () => {
    const c = [0, 7, 12, 15, 19]
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => arpeggio(c, i))).toEqual([0, 7, 12, 15, 19, 15, 12, 7, 0])
  })

  it('keeps the horn on the key and makes the phrase fill the cycle exactly', () => {
    let beats = 0
    for (const [s, n] of MOTIF) {
      if (s !== null) expect(KEY.has(mod(s)), `note ${s}`).toBe(true)
      expect(n).toBeGreaterThan(0)
      beats += n
    }
    expect(beats).toBe(CHORDS.length * BEATS_PER_CHORD / 2)
  })

  it('walks, not marches: a slow tempo', () => {
    expect(BPM).toBeLessThan(80)
    expect(BPM).toBeGreaterThan(50)
  })

  it('saturates intensity at a lane under pressure', () => {
    expect(intensity(0)).toBe(0)
    expect(intensity(50)).toBe(0.5)
    expect(intensity(5000)).toBe(1)
  })
})
