import { describe, it, expect } from 'vitest'
import { MatchResult, STARTING_LIVES, towerSlotAt } from '../src/state'
import { hashState } from '../src/hash'
import { GRID_H, SPAWN_ROWS } from '../src/grid'
import { TowerKind, creepSpec, tierUnlockTick } from '../src/data'
import { build, send, runUntil, tick, withGold, R, RUNNER, TANK, TANK2, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

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
for (let t = 0; t < RELENTLESS_RUNNERS; t++) RELENTLESS[t * 60] = [send(RUNNER, 1)]

/**
 * Pay for RELENTLESS up front. These tests are about what a leak does, not
 * about the purse: at the 2026-09-16 opening of 100 gold the sender could no
 * longer afford forty runners, the match never ended, and three tests about
 * zero lives failed on an economy number.
 */
const FUND_SENDER = (s: Parameters<typeof withGold>[0]) => {
  withGold(s, 1, RELENTLESS_RUNNERS * creepSpec(RUNNER).cost)
}

describe('the loop', () => {
  it('costs the defender a life per leak', () => {
    const s = runUntil((x) => x.players[0]!.leaks >= 3, lapTicks(RUNNER) * 3, RELENTLESS, FUND_SENDER)
    expect(s.players[0]!.leaks).toBeGreaterThanOrEqual(3)
    expect(s.players[0]!.lives).toBe(STARTING_LIVES - s.players[0]!.leaks)
  })

  it('credits the sender nothing — lives only ever go down', () => {
    // The damping rule as shipped. ADR-0008 / issue #7 hold the confirmed rule
    // that overrides it; unchanged by the geometry.
    const s = runUntil((x) => x.players[0]!.leaks >= 4, lapTicks(RUNNER) * 3, RELENTLESS, FUND_SENDER)
    expect(s.players[1]!.lives).toBe(STARTING_LIVES)
    expect(s.players[0]!.lives + s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('loops the creep instead of despawning it, keeping damage and lap count', () => {
    const s = runUntil(
      (x) => x.lanes[0]!.creeps.laps[0]! >= 2,
      lapTicks(RUNNER) * 3,
      { 0: [send(RUNNER, 1)] },
    )
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(2)
    // Back in the spawn zone, not removed and not parked at the exit.
    expect(s.lanes[0]!.creeps.y[0] as number).toBeLessThan(SPAWN_ROWS + 2)
  })

  it('never caps laps or decays a creep — only damage removes one', () => {
    const s = runUntil(
      (x) => x.lanes[0]!.creeps.laps[0]! >= 6,
      lapTicks(TANK) * 7,
      { 0: [send(TANK, 1)] },
    )
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(6)
    // Untouched: no tower ever fired at it.
    expect(s.lanes[0]!.creeps.hp[0] as number).toBe(creepSpec(TANK).hp)
  })

  it('ends the match at zero lives, with the other player as winner', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(RUNNER) * 4, RELENTLESS, FUND_SENDER)
    expect(s.result).toBe(MatchResult.Decided)
    expect(s.winner).toBe(1)
    expect(s.players[0]!.lives).toBe(0)
    expect(s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('never reports negative lives, even on the losing leak', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(RUNNER) * 4, RELENTLESS, FUND_SENDER)
    expect(s.players[0]!.lives).toBe(0)
  })

  it('freezes once the match is over — no tick, no commands, no movement', () => {
    const over = runUntil((x) => x.result !== MatchResult.Playing, lapTicks(RUNNER) * 4, RELENTLESS, FUND_SENDER)
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
      lapTicks(TANK) * (STARTING_LIVES + 1),
      { 0: [send(TANK, 1)] },
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
    // One tower against a Tank II is the losing end of that race by a hair.
    // The tower sits on the left edge so the tank, which spawns in column 0
    // and is routed around it, passes inside range every lap.
    const tier1At = tierUnlockTick(creepSpec(TANK2).tier)
    const horizon = tier1At + lapTicks(TANK2) * (STARTING_LIVES + 1)
    const weak = runUntil(
      (x) => x.players[0]!.kills > 0 || x.result !== MatchResult.Playing,
      horizon,
      { 0: [build(0, R + 4, TowerKind.Single, 0)], [tier1At]: [send(TANK2, 1)] },
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
        [tier1At]: [send(TANK2, 1)],
      },
    )
    expect(strong.players[0]!.kills).toBe(1)
    expect(strong.players[0]!.leaks).toBeLessThan(weak.players[0]!.leaks)
  })
})
