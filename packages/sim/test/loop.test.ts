import { describe, it, expect } from 'vitest'
import { MatchResult, STARTING_LIVES } from '../src/state'
import { hashState } from '../src/hash'
import { GRID_H, tileIndex } from '../src/grid'
import { TowerKind, creepSpec, tierUnlockTick } from '../src/data'
import { build, send, runUntil, tick, RUNNER, TANK, TANK2, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

/**
 * The loop is the identity mechanic: a creep that beats your maze comes back
 * and beats it again, taking a life every lap, until a tower kills it.
 *
 * Player 1 sends into lane 0 throughout, so player 0 is the one under pressure.
 */

/** Repeatedly send runners into lane 0, with no towers to stop them. */
const RELENTLESS: Record<number, ReturnType<typeof send>[]> = {}
for (let t = 0; t < 40; t++) RELENTLESS[t * 60] = [send(RUNNER, 1)]

describe('the loop', () => {
  it('costs the defender a life per leak', () => {
    const s = runUntil((x) => x.players[0]!.leaks >= 3, 6000, RELENTLESS)
    expect(s.players[0]!.leaks).toBeGreaterThanOrEqual(3)
    expect(s.players[0]!.lives).toBe(STARTING_LIVES - s.players[0]!.leaks)
  })

  it('credits the sender nothing — lives only ever go down', () => {
    // The damping rule. Crediting a sender would make each leak a 2-point
    // swing and let a leader compound in lives and income at once.
    const s = runUntil((x) => x.players[0]!.leaks >= 4, 6000, RELENTLESS)
    expect(s.players[1]!.lives).toBe(STARTING_LIVES)
    expect(s.players[0]!.lives + s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('loops the creep instead of despawning it, keeping damage and lap count', () => {
    const s = runUntil((x) => x.lanes[0]!.creeps.laps[0]! >= 2, 4000, { 0: [send(RUNNER, 1)] })
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(2)
    // Back near the spawn, not removed and not parked at the exit.
    expect(s.lanes[0]!.creeps.x[0] as number).toBeLessThan(2)
  })

  it('never caps laps or decays a creep — only damage removes one', () => {
    const s = runUntil((x) => x.lanes[0]!.creeps.laps[0]! >= 6, 10000, { 0: [send(TANK, 1)] })
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.laps[0] as number).toBeGreaterThanOrEqual(6)
    // Untouched: no tower ever fired at it. Derived from the data, because the
    // assertion is "full health", not "1400".
    expect(s.lanes[0]!.creeps.hp[0] as number).toBe(creepSpec(TANK).hp)
  })

  it('ends the match at zero lives, with the other player as winner', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, 40000, RELENTLESS)
    expect(s.result).toBe(MatchResult.Decided)
    expect(s.winner).toBe(1)
    expect(s.players[0]!.lives).toBe(0)
    expect(s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('never reports negative lives, even on the losing leak', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, 40000, RELENTLESS)
    expect(s.players[0]!.lives).toBe(0)
  })

  it('freezes once the match is over — no tick, no commands, no movement', () => {
    const over = runUntil((x) => x.result !== MatchResult.Playing, 40000, RELENTLESS)
    const before = hashState(over)
    const tickBefore = over.tick

    const after = tick(over, [build(5, 5, TowerKind.Single, 0)])
    expect(after.tick).toBe(tickBefore)
    expect(hashState(after)).toBe(before)
    expect(after.lanes[0]!.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
  })

  it('a creep taking no damage at all loops until the defender is out', () => {
    // The only way a creep genuinely never dies: nothing ever shoots it.
    // Damage persists across laps, so any tower that touches its route kills it
    // eventually — see the race test below.
    const s = runUntil((x) => x.result !== MatchResult.Playing, 40000, { 0: [send(TANK, 1)] })
    expect(s.result).toBe(MatchResult.Decided)
    expect(s.winner).toBe(1)
    expect(s.players[0]!.kills).toBe(0)
    expect(s.players[0]!.leaks).toBe(STARTING_LIVES)
  })

  it('is a race: a weak maze kills the creep, but may bleed out first', () => {
    // Correcting a claim the design doc got wrong. It said a creep whose HP
    // exceeds the maze's damage-per-lap "never dies". It does: damage persists
    // across laps and laps are unlimited, so accumulated damage passes any
    // finite HP. What actually decides the match is whether HP / damage-per-lap
    // laps is more or fewer than the lives you have left.
    //
    // One tower against a Tank II is the losing end of that race by a hair.
    //
    // The send waits for the tier to open rather than for tick 1300. That
    // literal was a tier clock in disguise: it sat comfortably past the old
    // 600-tick unlock, and when the ladder moved to three tiers five minutes
    // apart it silently became a send the rules refuse, which reads as "the
    // maze never killed anything" rather than as "nothing was ever sent".
    const tier1At = tierUnlockTick(creepSpec(TANK2).tier)
    const weak = runUntil(
      (x) => x.players[0]!.kills > 0,
      80000,
      { 0: [build(6, 11, TowerKind.Single, 0)], [tier1At]: [send(TANK2, 1)] },
    )
    expect(weak.players[0]!.kills).toBe(1)
    // It died — but only after taking lives with it. How many depends entirely
    // on tuning, so assert that it lapped rather than picking a number: a
    // threshold here would go red on every balance edit and say nothing.
    expect(weak.players[0]!.leaks).toBeGreaterThan(0)

    // More towers shorten the race decisively.
    const strong = runUntil(
      (x) => x.players[0]!.kills > 0,
      80000,
      {
        0: [
          build(6, 11, TowerKind.Single, 0),
          build(7, 11, TowerKind.Single, 0),
          build(8, 11, TowerKind.Single, 0),
          build(9, 11, TowerKind.Single, 0),
          build(10, 11, TowerKind.Single, 0),
          build(11, 11, TowerKind.Single, 0),
        ],
        [tier1At]: [send(TANK2, 1)],
      },
    )
    expect(strong.players[0]!.leaks).toBeLessThan(weak.players[0]!.leaks)
  })
})
