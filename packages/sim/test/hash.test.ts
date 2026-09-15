import { describe, it, expect } from 'vitest'
import { createState, insertTower, MatchResult, type GameState } from '../src/state'
import { hashState, hashHex } from '../src/hash'
import { tileIndex, BUILD_ROW_MIN } from '../src/grid'
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

const R = BUILD_ROW_MIN

/** A tower placed by hand, so the tower fields can be mutated one at a time. */
function withTower(s: GameState, ax = 4, ay = R + 4, kind = TowerKind.Single): number {
  return insertTower(s.lanes[0]!, 1, ax, ay, kind)
}

/** One mutation per hashable field. Add a field to state, add a line here. */
const MUTATIONS: readonly { name: string; apply: (s: GameState) => void }[] = [
  { name: 'tick', apply: (s) => { s.tick += 1 } },
  { name: 'nextCreepId', apply: (s) => { s.nextCreepId += 1 } },
  { name: 'nextTowerId', apply: (s) => { s.nextTowerId += 1 } },
  { name: 'players[0].gold', apply: (s) => { s.players[0]!.gold += 1 } },
  { name: 'kills', apply: (s) => { s.players[0]!.kills += 1 } },
  { name: 'lives', apply: (s) => { s.players[0]!.lives -= 1 } },
  { name: 'leaks', apply: (s) => { s.players[0]!.leaks += 1 } },
  { name: 'result', apply: (s) => { s.result = MatchResult.Decided } },
  { name: 'winner', apply: (s) => { s.winner = 1 } },
  { name: 'players[0].income', apply: (s) => { s.players[0]!.income += 1 } },
  { name: 'players[1].gold', apply: (s) => { s.players[1]!.gold += 1 } },
  { name: 'players[1].lives', apply: (s) => { s.players[1]!.lives -= 1 } },
  { name: 'lanes[1].blocked', apply: (s) => { s.lanes[1]!.blocked[tileIndex({ x: 3, y: R + 3 })] = 1 } },
  // `released` is the last survivor of the spawn queue, and the only one that
  // still had to be hashed: it decides where the NEXT creep starts, so peers
  // that disagree about it diverge on the next send.
  { name: 'lane.released', apply: (s) => { s.lanes[0]!.released = 5 } },
  { name: 'creeps.owner', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.owner[0] = 1 } },
  { name: 'creeps.spec', apply: (s) => { s.lanes[0]!.creeps.count = 1; s.lanes[0]!.creeps.spec[0] = 2 } },
  { name: 'lane.blocked', apply: (s) => { s.lanes[0]!.blocked[tileIndex({ x: 7, y: R + 7 })] = 1 } },
  // `lane.field` is deliberately absent: it is derived from `blocked` and no
  // longer hashed (see hashState). A mutation here would fail, and should.
  // Towers: the whole list, then one field at a time on a placed tower. The
  // anchor mutations move the tower without touching its caches, which is a
  // state no code path produces -- and exactly why the hash must see it.
  { name: 'towers.count', apply: (s) => { withTower(s) } },
  { name: 'towers.id', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.id[t] = 77 } },
  { name: 'towers.anchorX', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.anchorX[t] = 6 } },
  { name: 'towers.anchorY', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.anchorY[t] = R + 9 } },
  { name: 'towers.kind', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.kind[t] = TowerKind.Splash } },
  { name: 'towers.level', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.level[t] = 3 } },
  { name: 'towers.cooldown', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.cooldown[t] = 7 } },
  { name: 'towers.acquire', apply: (s) => { const t = withTower(s); s.lanes[0]!.towers.acquire[t] = 3 } },
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

  it('tells two towers apart by every field, not just by count', () => {
    // Each tower-field mutation above is applied on top of a placed tower, so
    // each must differ from the plain placed tower too, or the field is unhashed.
    const placed = createState()
    withTower(placed)
    const ref = hashState(placed)
    for (const m of MUTATIONS.filter((x) => x.name.startsWith('towers.') && x.name !== 'towers.count')) {
      const s = createState()
      m.apply(s)
      expect(hashState(s), m.name).not.toBe(ref)
    }
  })

  it('does not hash the flow field, which is derived from what it does hash', () => {
    // Deliberate, and measured: see the comment in hashState. If this starts
    // failing, someone put the field back and determinism-check got ten times
    // slower for a divergence the creep positions already catch.
    const s = createState()
    s.lanes[0]!.field.dist[42] = 999
    expect(hashState(s)).toBe(baseline)
  })

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
