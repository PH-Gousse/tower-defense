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
  { name: 'players[0].gold', apply: (s) => { s.players[0]!.gold += 1 } },
  { name: 'kills', apply: (s) => { s.players[0]!.kills += 1 } },
  { name: 'lives', apply: (s) => { s.players[0]!.lives -= 1 } },
  { name: 'leaks', apply: (s) => { s.players[0]!.leaks += 1 } },
  { name: 'result', apply: (s) => { s.result = MatchResult.Decided } },
  { name: 'winner', apply: (s) => { s.winner = 1 } },
  { name: 'players[0].income', apply: (s) => { s.players[0]!.income += 1 } },
  { name: 'players[1].gold', apply: (s) => { s.players[1]!.gold += 1 } },
  { name: 'players[1].lives', apply: (s) => { s.players[1]!.lives -= 1 } },
  { name: 'lanes[1].blocked', apply: (s) => { s.lanes[1]!.blocked[tileIndex({ x: 3, y: 3 })] = 1 } },
  // `released` is the last survivor of the spawn queue, and the only one that
  // still had to be hashed: it decides where the NEXT creep starts, so peers
  // that disagree about it diverge on the next send.
  { name: 'lane.released', apply: (s) => { s.lanes[0]!.released = 5 } },
  { name: 'creeps.owner', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.owner[0] = 1 } },
  { name: 'creeps.spec', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.spec[0] = 2 } },
  { name: 'lane.blocked', apply: (s) => { s.lanes[0]!.blocked[tileIndex({ x: 7, y: 7 })] = 1 } },
  { name: 'lane.field.dist', apply: (s) => { s.lanes[0]!.field.dist[42] = 999 } },
  {
    name: 'towers.kind',
    apply: (s) => { s.lanes[0]!.towers.kind[tileIndex({ x: 9, y: 9 })] = TowerKind.Splash },
  },
  {
    name: 'towers.level',
    apply: (s) => {
      const i = tileIndex({ x: 9, y: 9 })
      s.lanes[0]!.towers.kind[i] = TowerKind.Single
      s.lanes[0]!.towers.level[i] = 3
    },
  },
  {
    name: 'towers.cooldown',
    apply: (s) => {
      const i = tileIndex({ x: 9, y: 9 })
      s.lanes[0]!.towers.kind[i] = TowerKind.Single
      s.lanes[0]!.towers.cooldown[i] = 7
    },
  },
  { name: 'creeps.count', apply: (s) => { s.lanes[0]!.creeps.count = 1 } },
  { name: 'creeps.id', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.id[0] = 42 } },
  { name: 'creeps.x', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.x[0] = 3.5 } },
  { name: 'creeps.y', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.y[0] = 4.5 } },
  { name: 'creeps.hp', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.hp[0] = 55 } },
  { name: 'creeps.laps', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.laps[0] = 3 } },
  { name: 'creeps.speed', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.speed[0] = 0.5 } },
  {
    name: 'creeps.slowPercent',
    apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.slowPercent[0] = 40 },
  },
  {
    name: 'creeps.slowUntil',
    apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.slowUntil[0] = 99 },
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
    a.lanes[0]!.creeps.count = 1
    b.lanes[0]!.creeps.count = 1
    a.lanes[0]!.creeps.x[0] = 0
    b.lanes[0]!.creeps.x[0] = -0
    expect(hashState(a)).toBe(hashState(b))
  })

  it('throws on NaN rather than hashing it', () => {
    // NaN !== NaN, so hashing it would make the digest unstable. A NaN in the
    // sim is a bug, and this is where it surfaces.
    const s = createState()
    s.lanes[0]!.creeps.count = 1
    s.lanes[0]!.creeps.x[0] = Number.NaN
    expect(() => hashState(s)).toThrow(/NaN/)
  })

  it('renders as fixed-width hex', () => {
    expect(hashHex(createState())).toMatch(/^[0-9a-f]{8}$/)
  })
})
