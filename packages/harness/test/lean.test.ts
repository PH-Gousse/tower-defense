import { describe, it, expect } from 'vitest'
import { CREEPS, CreepArchetypeKind } from '@ltw/sim'
import { goldShares, leanAcross, shapeOf } from '../tools/lib/lean'

/**
 * The degenerate flag compares the winner's send mix with the loser's. A
 * pattern both sides play is not a pattern that is winning.
 */
const idx = (name: string) => {
  const i = CREEPS.findIndex((c) => c.name === name)
  if (i === -1) throw new Error(`no creep named ${name}`)
  return i
}
function sends(spec: Record<string, number>): number[] {
  const by = new Array<number>(CREEPS.length).fill(0)
  for (const [name, n] of Object.entries(spec)) by[idx(name)] = n
  return by
}

describe('goldShares', () => {
  it('weighs by gold and folds the ladder into its three shapes', () => {
    // 10 Scrapling at 50 = 500 and one Ember Imp at 500, both horde; one Bog
    // Brute at 220, armoured (stored gold, x10).
    const s = goldShares(sends({ Scrapling: 10, 'Bog Brute': 1, 'Ember Imp': 1 }))
    expect(s.get('Horde')).toBeCloseTo(1000 / 1220, 9)
    expect(s.get('Armoured')).toBeCloseTo(220 / 1220, 9)
    expect(s.has('Scrapling')).toBe(false)
    expect(shapeOf(CreepArchetypeKind.Fast)).toBe('Fast')
  })

  it('is empty for a seat that sent nothing', () => {
    expect(goldShares(undefined).size).toBe(0)
    expect(goldShares([]).size).toBe(0)
  })
})

describe('leanAcross', () => {
  it('flags nothing when both seats sent the same mix, however lopsided that mix is', () => {
    // Both seats all horde, ten matches: the old flag fired on this.
    const mix = sends({ Wraith: 40 })
    const out = leanAcross(Array.from({ length: 10 }, () => ({ winner: mix, loser: mix })), 0.7, 0.1)
    expect(out.every((l) => !l.flagged)).toBe(true)
    expect(out.find((l) => l.archetype === 'Horde')!.lean).toBe(0)
  })

  it('flags the shape winners lean on more than losers, match after match', () => {
    const winner = sends({ 'Iron Golem': 4, Scrapling: 10 }) // 100000 + 500: armoured-heavy
    const loser = sends({ Scrapling: 40 })
    const out = leanAcross(Array.from({ length: 10 }, () => ({ winner, loser })), 0.7, 0.1)
    const armoured = out.find((l) => l.archetype === 'Armoured')!
    expect(armoured.flagged).toBe(true)
    expect(armoured.leanedIn).toBe(10)
    expect(armoured.lean).toBeGreaterThan(0.8)
    expect(out.find((l) => l.archetype === 'Horde')!.flagged).toBe(false)
    expect(out[0]!.archetype).toBe('Armoured')
  })

  it('does not flag a lean that only shows in a minority of matches', () => {
    const armoured = sends({ 'Iron Golem': 4 })
    const horde = sends({ Scrapling: 40 })
    const matches = [
      ...Array.from({ length: 4 }, () => ({ winner: armoured, loser: horde })),
      ...Array.from({ length: 6 }, () => ({ winner: horde, loser: armoured })),
    ]
    const out = leanAcross(matches, 0.7, 0.1)
    expect(out.every((l) => !l.flagged)).toBe(true)
  })

  it('ignores matches where neither seat sent, and copes with none at all', () => {
    expect(leanAcross([], 0.7, 0.1)).toEqual([])
    const out = leanAcross([{ winner: [], loser: undefined }], 0.7, 0.1)
    expect(out).toEqual([])
  })
})
