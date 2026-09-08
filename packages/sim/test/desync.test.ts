import { describe, it, expect } from 'vitest'
import { HashRing, RING_SIZE, findDivergence, type HashEntry } from '../src/desync'
import { createState } from '../src/state'
import { step } from '../src/step'
import { hashState } from '../src/hash'

describe('hash ring', () => {
  it('keeps the newest RING_SIZE ticks, oldest first', () => {
    const r = new HashRing()
    for (let t = 0; t < RING_SIZE + 15; t++) r.push(t, t * 7)
    const e = r.entries()
    expect(e).toHaveLength(RING_SIZE)
    expect(e[0]!.tick).toBe(15)
    expect(e[RING_SIZE - 1]!.tick).toBe(RING_SIZE + 14)
    // Ascending order is not cosmetic: findDivergence walks forward and returns
    // the FIRST mismatch, which is only the earliest one if the ring is sorted.
    for (let i = 1; i < e.length; i++) expect(e[i]!.tick).toBeGreaterThan(e[i - 1]!.tick)
  })

  it('is partially filled before it wraps', () => {
    const r = new HashRing()
    r.push(0, 1)
    r.push(1, 2)
    expect(r.entries().map((x) => x.tick)).toEqual([0, 1])
    expect(r.size).toBe(2)
  })

  it('records the hash of a real state', () => {
    const r = new HashRing()
    const s = createState()
    r.record(s)
    expect(r.entries()[0]).toEqual({ tick: s.tick, hash: hashState(s) >>> 0 })
  })
})

describe('finding where two clients parted', () => {
  const ring = (ticks: number[], hashes: number[]): HashEntry[] =>
    ticks.map((t, i) => ({ tick: t, hash: hashes[i] as number }))

  it('agrees when every shared tick matches', () => {
    const a = ring([1, 2, 3], [10, 20, 30])
    expect(findDivergence(a, a)).toMatchObject({ reason: 'agree', compared: 3 })
  })

  it('returns the EARLIEST disagreement, not the latest', () => {
    // The whole reason a ring is kept. Every tick after a divergence is also
    // wrong, so the newest mismatch is the least informative one; the earliest
    // is the tick whose inputs are worth reading.
    const mine = ring([1, 2, 3, 4], [10, 20, 30, 40])
    const theirs = ring([1, 2, 3, 4], [10, 99, 98, 97])
    expect(findDivergence(mine, theirs)).toMatchObject({ reason: 'diverged', tick: 2 })
  })

  it('compares only the ticks both sides kept', () => {
    // A peer running behind shares a window with us, not a whole match.
    const mine = ring([5, 6, 7], [50, 60, 70])
    const theirs = ring([3, 4, 5, 6], [30, 40, 50, 61])
    const d = findDivergence(mine, theirs)
    expect(d).toMatchObject({ reason: 'diverged', tick: 6, compared: 2 })
  })

  it('reports no-overlap rather than guessing', () => {
    // A peer more than a ring behind is a stall, and a stall is not a desync.
    // Calling it one would freeze a match over a slow connection.
    const d = findDivergence(ring([100, 101], [1, 2]), ring([1, 2], [1, 2]))
    expect(d.reason).toBe('no-overlap')
    expect(d.tick).toBe(-1)
  })

  it('catches a divergence produced by an actually different simulation', () => {
    // Not synthetic numbers: run the same opening on two states and perturb one
    // creep's HP mid-match, the way a real arithmetic divergence would.
    const run = (perturbAt: number): HashEntry[] => {
      let a = createState()
      let b = createState()
      const out: HashEntry[] = []
      for (let t = 0; t < 60; t++) {
        const next = step(a, [], b)
        b = a
        a = next
        if (t === perturbAt) (a as { nextCreepId: number }).nextCreepId += 1
        out.push({ tick: a.tick, hash: hashState(a) >>> 0 })
      }
      return out
    }
    const d = findDivergence(run(-1), run(30))
    expect(d.reason).toBe('diverged')
    expect(d.tick).toBe(31)
  })
})
