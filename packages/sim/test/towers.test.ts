import { describe, it, expect } from 'vitest'
import { createSpatialHash, rebuildHash } from '../src/towers'
import { TowerKind, levelOf, ARCHETYPES, creepSpec } from '../src/data'
import { hashState } from '../src/hash'
import { build, send, run, runUntil, SWARM, RUNNER, TANK, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

describe('spatial hash', () => {
  it('buckets creeps by tile, ascending within a bucket', () => {
    // Stability is the targeting tiebreak: within a bucket, ascending
    // creep-array index means ascending id.
    const s = run(60, { 0: [send(SWARM, 1)] })
    const hash = createSpatialHash(2048)
    rebuildHash(s.lanes[0]!, hash)

    let seen = 0
    for (let t = 0; t < hash.bucketStart.length - 1; t++) {
      const from = hash.bucketStart[t] as number
      const to = hash.bucketStart[t + 1] as number
      for (let k = from + 1; k < to; k++) {
        expect(hash.bucketItems[k] as number).toBeGreaterThan(hash.bucketItems[k - 1] as number)
      }
      seen += to - from
    }
    expect(seen).toBe(s.lanes[0]!.creeps.count)
  })
})

describe('towers', () => {
  it('kills a creep that walks into range', () => {
    const s = runUntil((x) => x.players[0]!.kills > 0, 4000, {
      0: [build(5, 11, TowerKind.Single, 0)],
      1: [build(5, 12, TowerKind.Single, 0)],
      2: [send(RUNNER, 1)],
    })
    expect(s.players[0]!.kills).toBeGreaterThan(0)
  })

  it('leaves a creep alive when it out-tanks the maze', () => {
    // A tank against a single tower: damaged, but it completes a lap.
    //
    // Asserted against the lap rather than against a tick budget. "Alive after
    // 1200 ticks" was a statement about the roster, not about towers: it held
    // while a tank had 900 HP and stopped holding the moment the ladder gave it
    // 250, even though nothing about tower behaviour had changed. Surviving one
    // full lap is the claim that actually belongs here, and it survives tuning.
    const s = runUntil(
      (x) => x.players[0]!.leaks > 0,
      20000,
      { 0: [build(5, 11, TowerKind.Single, 0)], 1: [send(TANK, 1)] },
    )
    expect(s.players[0]!.leaks).toBeGreaterThan(0)
    expect(s.players[0]!.kills).toBe(0)
    expect(s.lanes[0]!.creeps.count).toBe(1)
    // Damaged on the way round, read from the roster rather than a literal.
    expect(s.lanes[0]!.creeps.hp[0] as number).toBeLessThan(creepSpec(TANK).hp)
  })

  it('respects cooldown rather than firing every tick', () => {
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    const dmg = levelOf(TowerKind.Single, 1).damage
    const ticks = 600
    const s = run(ticks, { 0: [build(5, 11, TowerKind.Single, 0)], 1: [send(TANK, 1)] })
    // Read the starting HP from the data. The literal that used to be here was
    // 1400 against a 900 HP tank, so "dealt" was 500 too high and the upper
    // bound was one tuning edit from going red for the wrong reason.
    const dealt = creepSpec(TANK).hp - (s.lanes[0]!.creeps.hp[0] as number)
    expect(dealt).toBeGreaterThan(0)
    expect(dealt).toBeLessThanOrEqual((ticks / cd + 2) * dmg)
  })

  it('applies a slow while the creep is in range', () => {
    // Checked at tick 100, while the creep is still crossing the entrance row
    // inside a 2.25-tile range of (5,2). The slow lasts 20 ticks, so by tick 400
    // the creep is far down the lane and asserting then would test nothing.
    const s = run(100, { 0: [build(5, 2, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBeGreaterThan(0)
  })

  it('lets the slow expire once the creep is out of range', () => {
    const s = run(400, { 0: [build(5, 2, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBe(0)
  })

  it('leaves a slowed creep behind an unslowed one', () => {
    const slowed = run(400, { 0: [build(5, 2, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    const free = run(400, { 1: [send(TANK, 1)] })
    // Down the lane is +y, so "behind" is a smaller y.
    expect(slowed.lanes[0]!.creeps.y[0] as number).toBeLessThan(
      free.lanes[0]!.creeps.y[0] as number,
    )
  })

  it('splash damages several creeps from one shot', () => {
    // Six swarm bought on one tick, which is what a wave is now that a purchase
    // is a single creep. Splash exists to answer several creeps at once, so the
    // test has to put several there -- with one creep it would be measuring
    // single-target damage under another name.
    const wave = Array.from({ length: 6 }, () => send(SWARM, 1))
    const s = run(400, { 0: [build(5, 11, TowerKind.Splash, 0)], 1: wave })
    const alive = s.lanes[0]!.creeps.count
    // Against the creep's own starting HP, not a literal. The old threshold was
    // 90 against a 30 HP swarm, so every living creep counted as "hurt" and the
    // test passed with the tower parked four tiles off the route.
    const full = creepSpec(SWARM).hp
    const hurt = Array.from(s.lanes[0]!.creeps.hp.slice(0, alive)).filter((h) => h < full)
    // Either several are damaged, or several already died from the splash.
    expect(hurt.length + s.players[0]!.kills).toBeGreaterThan(1)
  })

  it('only defends its own lane', () => {
    // A tower in lane 0 must never shoot a creep in lane 1.
    const s = run(600, {
      0: [build(5, 11, TowerKind.Single, 0)],
      1: [send(RUNNER, 0)], // player 0 sends -> creeps land in lane 1
    })
    expect(s.lanes[1]!.creeps.count).toBe(1)
    // Read from the data rather than written out: the point is that it took no
    // damage, and a literal here turns every tuning edit into a red test.
    expect(s.lanes[1]!.creeps.hp[0] as number).toBe(creepSpec(RUNNER).hp)
    expect(s.players[1]!.kills).toBe(0)
  })
})

describe('data integrity', () => {
  it('has three archetypes of three levels, ordered to match TowerKind', () => {
    expect(ARCHETYPES.length).toBe(3)
    expect(ARCHETYPES[TowerKind.Single]?.key).toBe('single')
    expect(ARCHETYPES[TowerKind.Splash]?.key).toBe('splash')
    expect(ARCHETYPES[TowerKind.Slow]?.key).toBe('slow')
    for (const a of ARCHETYPES) expect(a.levels.length).toBe(3)
  })

  it('makes every upgrade cost more and hit harder', () => {
    for (const a of ARCHETYPES) {
      for (let l = 1; l < a.levels.length; l++) {
        expect(a.levels[l]!.cost).toBeGreaterThan(a.levels[l - 1]!.cost)
        expect(a.levels[l]!.damage).toBeGreaterThan(a.levels[l - 1]!.damage)
        expect(a.levels[l]!.range).toBeGreaterThanOrEqual(a.levels[l - 1]!.range)
      }
    }
  })
})

describe('determinism with towers and sends', () => {
  it('produces the same hash for the same commands', () => {
    const cmds = {
      2: [build(5, 11, TowerKind.Single, 0)],
      6: [build(4, 12, TowerKind.Splash, 0)],
      9: [build(5, 16, TowerKind.Slow, 0)],
      20: [send(SWARM, 1)],
      60: [send(RUNNER, 1)],
      90: [send(SWARM, 0)],
    }
    expect(hashState(run(900, cmds))).toBe(hashState(run(900, cmds)))
  })
})
