import { describe, it, expect } from 'vitest'
import { MatchResult, STARTING_LIVES, towerSlotAt } from '../src/state'
import { hashState } from '../src/hash'
import { GRID_H, SPAWN_ROWS } from '../src/grid'
import { TowerKind, creepSpec, tierUnlockTick } from '../src/data'
import { build, send, runUntil, tick, withGold, R, DASHER_HOUND, BOG_BRUTE, withEveryCreepUnlocked } from './helpers'

// Not a test of the opening or the unlock clock: see withEveryCreepUnlocked.
withEveryCreepUnlocked()

/**
 * The loop is the identity mechanic: a creep that beats your maze comes back
 * and beats it again, taking a life every lap, until a tower kills it.
 *
 * Player 1 sends into lane 0 throughout, so player 0 is the one under pressure.
 *
 * Tick budgets are derived from the lane: a bare lap is GRID_H rows at the
 * creep's speed. A literal here would be a statement about the old 24-row
 * board dressed up as a test.
 */
const lapTicks = (creep: number) => Math.ceil(GRID_H / creepSpec(creep).speed)

/** Repeatedly send runners into lane 0, with no towers to stop them. */
const RELENTLESS: Record<number, ReturnType<typeof send>[]> = {}
const RELENTLESS_RUNNERS = 40
for (let t = 0; t < RELENTLESS_RUNNERS; t++) RELENTLESS[t * 60] = [send(DASHER_HOUND, 1)]

/**
 * Pay for RELENTLESS up front. These tests are about what a leak does, not
 * about the purse: at the 2026-09-16 opening of 100 gold the sender could no
 * longer afford forty runners, the match never ended, and three tests about
 * zero lives failed on an economy number.
 */
const FUND_SENDER = (s: Parameters<typeof withGold>[0]) => {
  withGold(s, 1, RELENTLESS_RUNNERS * creepSpec(DASHER_HOUND).cost)
}

describe('the loop', () => {
  it('costs the defender a life per leak', () => {
    const s = runUntil((x) => x.players[0]!.leaks >= 3, lapTicks(DASHER_HOUND) * 3, RELENTLESS, FUND_SENDER)
    expect(s.players[0]!.leaks).toBeGreaterThanOrEqual(3)
    expect(s.players[0]!.lives).toBe(STARTING_LIVES - s.players[0]!.leaks)
  })

  it('credits the sender nothing — lives only ever go down', () => {
    // The damping rule as shipped. ADR-0008 / issue #7 hold the confirmed rule
    // that overrides it; unchanged by the geometry.
    const s = runUntil((x) => x.players[0]!.leaks >= 4, lapTicks(DASHER_HOUND) * 3, RELENTLESS, FUND_SENDER)
    expect(s.players[1]!.lives).toBe(STARTING_LIVES)
    expect(s.players[0]!.lives + s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('loops the creep instead of despawning it, keeping damage and lap count', () => {
    const s = runUntil(
      (x) => x.lanes[0]!.creeps.laps[0]! >= 2,
      lapTicks(DASHER_HOUND) * 3,
      { 0: [send(DASHER_HOUND, 1)] },
    )
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(2)
    // Back in the spawn zone, not removed and not parked at the exit.
    expect(s.lanes[0]!.creeps.y[0] as number).toBeLessThan(SPAWN_ROWS + 2)
  })

  it('never caps laps or decays a creep — only damage removes one', () => {
    const s = runUntil(
      (x) => x.lanes[0]!.creeps.laps[0]! >= 6,
      lapTicks(BOG_BRUTE) * 7,
      { 0: [send(BOG_BRUTE, 1)] },
    )
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(6)
    // Untouched: no tower ever fired at it.
    expect(s.lanes[0]!.creeps.hp[0] as number).toBe(creepSpec(BOG_BRUTE).hp)
  })

  it('ends the match at zero lives, with the other player as winner', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(DASHER_HOUND) * 4, RELENTLESS, FUND_SENDER)
    expect(s.result).toBe(MatchResult.Decided)
    expect(s.winner).toBe(1)
    expect(s.players[0]!.lives).toBe(0)
    expect(s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('never reports negative lives, even on the losing leak', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(DASHER_HOUND) * 4, RELENTLESS, FUND_SENDER)
    expect(s.players[0]!.lives).toBe(0)
  })

  it('freezes once the match is over — no tick, no commands, no movement', () => {
    const over = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(DASHER_HOUND) * 4, RELENTLESS, FUND_SENDER)
    const before = hashState(over)
    const tickBefore = over.tick

    const after = tick(over, [build(4, R + 4, TowerKind.Single, 0)])
    expect(after.tick).toBe(tickBefore)
    expect(hashState(after)).toBe(before)
    expect(towerSlotAt(after.lanes[0]!, 4, R + 4)).toBe(-1)
  })

  it('a creep taking no damage at all loops until the defender is out', () => {
    // The only way a creep genuinely never dies: nothing ever shoots it.
    const s = runUntil(
      (x) => x.result !== MatchResult.Playing,
      lapTicks(BOG_BRUTE) * (STARTING_LIVES + 1),
      { 0: [send(BOG_BRUTE, 1)] },
    )
    expect(s.result).toBe(MatchResult.Decided)
    expect(s.winner).toBe(1)
    expect(s.players[0]!.kills).toBe(0)
    expect(s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('is a race: a weak maze kills the creep, but may bleed out first', () => {
    // Damage persists across laps and laps are unlimited, so accumulated
    // damage passes any finite HP. What decides the match is whether
    // HP / damage-per-lap laps is more or fewer than the lives you have left.
    //
    // One tower against a Bog Brute bleeds lives before it kills. The probe
    // was a Tank II (1,250 HP) on the three-by-three roster; its index is now
    // the Stone Troll at 8,350, which one level-1 guard cannot finish inside
    // twenty laps, so the race had no end to measure (ADR-0031). The Bog Brute
    // is the armoured rung that keeps the race's shape. The tower sits on the
    // left edge so the creep, routed around it, passes inside range every lap.
    const PROBE = BOG_BRUTE
    // A tick after the builds: at tick 0 the key would collide with theirs and
    // replace them, and the race would be run against an empty lane.
    const sentAt = tierUnlockTick(creepSpec(PROBE).tier) + 1
    // The race is about laps and lives, not about affording the creep.
    const FUND_PROBE = (st: Parameters<typeof withGold>[0]) => {
      withGold(st, 1, creepSpec(PROBE).cost)
    }
    const horizon = sentAt + lapTicks(PROBE) * (STARTING_LIVES + 1)
    const weak = runUntil(
      (x) => x.players[0]!.kills > 0 || x.result !== MatchResult.Playing,
      horizon,
      { 0: [build(0, R + 4, TowerKind.Single, 0)], [sentAt]: [send(PROBE, 1)] },
      FUND_PROBE,
    )
    expect(weak.players[0]!.kills + weak.players[0]!.leaks).toBeGreaterThan(0)
    expect(weak.players[0]!.leaks).toBeGreaterThan(0)

    // More towers shorten the race decisively.
    const strong = runUntil(
      (x) => x.players[0]!.kills > 0 || x.result !== MatchResult.Playing,
      horizon,
      {
        0: [
          build(0, R + 4, TowerKind.Single, 0),
          build(0, R + 6, TowerKind.Single, 0),
          build(0, R + 8, TowerKind.Single, 0),
          build(0, R + 10, TowerKind.Single, 0),
          build(0, R + 12, TowerKind.Single, 0),
          build(0, R + 14, TowerKind.Single, 0),
        ],
        [sentAt]: [send(PROBE, 1)],
      },
      FUND_PROBE,
    )
    expect(strong.players[0]!.kills).toBe(1)
    expect(strong.players[0]!.leaks).toBeLessThan(weak.players[0]!.leaks)
  })
})
