import { describe, it, expect } from 'vitest'
import { CREEPS } from '@ltw/sim'
import { goldShares, leanAcross, archetypeOf } from '../tools/lib/lean'

/**
 * The degenerate flag compares the winner's send mix with the loser's. A
 * pattern both sides play is not a pattern that is winning.
 */
const idx = (name: string) => CREEPS.findIndex((c) => c.name === name)
function sends(spec: Record<string, number>): number[] {
  const by = new Array<number>(CREEPS.length).fill(0)
  for (const [name, n] of Object.entries(spec)) by[idx(name)] = n
  return by
}

describe('goldShares', () => {
  it('weighs by gold and folds tiers into their archetype', () => {
    // 30 swarm at 20 gold = 600; 1 tank at 600 = 600; one Swarm II at 100.
    const s = goldShares(sends({ Swarm: 30, Tank: 1, 'Swarm II': 1 }))
    expect(s.get('Swarm')).toBeCloseTo(700 / 1300, 9)
    expect(s.get('Tank')).toBeCloseTo(600 / 1300, 9)
    expect(s.has('Swarm II')).toBe(false)
    expect(archetypeOf('Runner III')).toBe('Runner')
  })

  it('is empty for a seat that sent nothing', () => {
    expect(goldShares(undefined).size).toBe(0)
    expect(goldShares([]).size).toBe(0)
  })
})

describe('leanAcross', () => {
  it('flags nothing when both seats sent the same mix, however lopsided that mix is', () => {
    // Both seats 100% Swarm III, ten matches: the old flag fired on this.
    const mix = sends({ 'Swarm III': 40 })
    const out = leanAcross(Array.from({ length: 10 }, () => ({ winner: mix, loser: mix })), 0.7, 0.1)
    expect(out.every((l) => !l.flagged)).toBe(true)
    expect(out.find((l) => l.archetype === 'Swarm')!.lean).toBe(0)
  })

  it('flags the archetype winners lean on more than losers, match after match', () => {
    const winner = sends({ 'Tank III': 4, 'Swarm III': 10 }) // 60000 + 5000: tank-heavy
    const loser = sends({ 'Swarm III': 40 })
    const out = leanAcross(Array.from({ length: 10 }, () => ({ winner, loser })), 0.7, 0.1)
    const tank = out.find((l) => l.archetype === 'Tank')!
    expect(tank.flagged).toBe(true)
    expect(tank.leanedIn).toBe(10)
    expect(tank.lean).toBeGreaterThan(0.8)
    expect(out.find((l) => l.archetype === 'Swarm')!.flagged).toBe(false)
    expect(out[0]!.archetype).toBe('Tank')
  })

  it('does not flag a lean that only shows in a minority of matches', () => {
    const tanky = sends({ 'Tank III': 4 })
    const swarmy = sends({ 'Swarm III': 40 })
    const matches = [
      ...Array.from({ length: 4 }, () => ({ winner: tanky, loser: swarmy })),
      ...Array.from({ length: 6 }, () => ({ winner: swarmy, loser: tanky })),
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
