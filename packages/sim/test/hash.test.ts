import { describe, it, expect } from 'vitest'
import { createState, MatchResult, type GameState } from '../src/state'
import { hashState, hashHex } from '../src/hash'
import { tileIndex } from '../src/grid'
import { TowerKind } from '../src/data'

/**
 * Guard against the hash silently stopping covering the match.
 *
 * This is the only desync detector in the system, and it failed quietly twice
 * while the state grew under it: gold and towers went unhashed when they were
 * added at step 4, lives when added at step 5. Two clients could have disagreed
 * about a tower's level and the hash would have reported agreement — which is
 * worse than having no detector, because it looks like one.
 *
 * The fix is not care. The fix is this test: every field is mutated in turn and
 * the hash must move. Adding a field to GameState without adding it to
 * hashState fails here.
 */

/** One mutation per hashable field. Add a field to state, add a line here. */
const MUTATIONS: readonly { name: string; apply: (s: GameState) => void }[] = [
  { name: 'tick', apply: (s) => { s.tick += 1 } },
  { name: 'nextCreepId', apply: (s) => { s.nextCreepId += 1 } },
  { name: 'gold', apply: (s) => { s.gold += 1 } },
  { name: 'kills', apply: (s) => { s.kills += 1 } },
  { name: 'lives', apply: (s) => { s.lives -= 1 } },
  { name: 'leaks', apply: (s) => { s.leaks += 1 } },
  { name: 'result', apply: (s) => { s.result = MatchResult.Defeat } },
  { name: 'lane.blocked', apply: (s) => { s.lane.blocked[tileIndex({ x: 7, y: 7 })] = 1 } },
  { name: 'lane.field.dist', apply: (s) => { s.lane.field.dist[42] = 999 } },
  {
    name: 'towers.kind',
    apply: (s) => { s.lane.towers.kind[tileIndex({ x: 9, y: 9 })] = TowerKind.Splash },
  },
  {
    name: 'towers.level',
    apply: (s) => {
      const i = tileIndex({ x: 9, y: 9 })
      s.lane.towers.kind[i] = TowerKind.Single
      s.lane.towers.level[i] = 3
    },
  },
  {
    name: 'towers.cooldown',
    apply: (s) => {
      const i = tileIndex({ x: 9, y: 9 })
      s.lane.towers.kind[i] = TowerKind.Single
      s.lane.towers.cooldown[i] = 7
    },
  },
  { name: 'creeps.count', apply: (s) => { s.lane.creeps.count = 1 } },
  { name: 'creeps.id', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.id[0] = 42 } },
  { name: 'creeps.x', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.x[0] = 3.5 } },
  { name: 'creeps.y', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.y[0] = 4.5 } },
  { name: 'creeps.hp', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.hp[0] = 55 } },
  { name: 'creeps.laps', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.laps[0] = 3 } },
  { name: 'creeps.speed', apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.speed[0] = 0.5 } },
  {
    name: 'creeps.slowPercent',
    apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.slowPercent[0] = 40 },
  },
  {
    name: 'creeps.slowUntil',
    apply: (s) => { s.lane.creeps.count = 1; s.lane.creeps.slowUntil[0] = 99 },
  },
]

describe('hashState covers the whole match', () => {
  const baseline = hashState(createState())

  for (const m of MUTATIONS) {
    it(`notices a change to ${m.name}`, () => {
      const s = createState()
      m.apply(s)
      expect(hashState(s)).not.toBe(baseline)
    })
  }

  it('is stable for an unchanged state', () => {
    expect(hashState(createState())).toBe(baseline)
  })

  it('normalises -0 so it cannot desync against 0', () => {
    // -0 and 0 compare equal but have different bit patterns, so an unnormalised
    // hash would report a divergence between two states that are numerically
    // identical — the worst kind of false positive to debug.
    const a = createState()
    const b = createState()
    a.lane.creeps.count = 1
    b.lane.creeps.count = 1
    a.lane.creeps.x[0] = 0
    b.lane.creeps.x[0] = -0
    expect(hashState(a)).toBe(hashState(b))
  })

  it('throws on NaN rather than hashing it', () => {
    // NaN !== NaN, so hashing it would make the digest unstable. A NaN in the
    // sim is a bug, and this is where it surfaces.
    const s = createState()
    s.lane.creeps.count = 1
    s.lane.creeps.x[0] = Number.NaN
    expect(() => hashState(s)).toThrow(/NaN/)
  })

  it('renders as fixed-width hex', () => {
    expect(hashHex(createState())).toMatch(/^[0-9a-f]{8}$/)
  })
})
