import { describe, it, expect } from 'vitest'
import { createSpatialHash, rebuildHash } from '../src/towers'
import { TowerKind, levelOf, ARCHETYPES } from '../src/data'
import { hashState } from '../src/hash'
import { build, send, run, runUntil, SWARM, RUNNER, TANK } from './helpers'

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
      0: [build(3, 11, TowerKind.Single, 0)],
      1: [build(3, 12, TowerKind.Single, 0)],
      2: [send(RUNNER, 1)],
    })
    expect(s.players[0]!.kills).toBeGreaterThan(0)
  })

  it('leaves a creep alive when it out-tanks the maze', () => {
    // A tank against a single tower: damaged, but never killed.
    const s = run(1200, { 0: [build(3, 11, TowerKind.Single, 0)], 1: [send(TANK, 1)] })
    expect(s.players[0]!.kills).toBe(0)
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[0]!.creeps.hp[0] as number).toBeLessThan(1400)
  })

  it('respects cooldown rather than firing every tick', () => {
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    const dmg = levelOf(TowerKind.Single, 1).damage
    const ticks = 600
    const s = run(ticks, { 0: [build(3, 11, TowerKind.Single, 0)], 1: [send(TANK, 1)] })
    const dealt = 1400 - (s.lanes[0]!.creeps.hp[0] as number)
    expect(dealt).toBeGreaterThan(0)
    expect(dealt).toBeLessThanOrEqual((ticks / cd + 2) * dmg)
  })

  it('applies a slow while the creep is in range', () => {
    // Checked at tick 100, while the creep is still inside a 4.5-tile range
    // from x=4. The slow lasts 20 ticks, so by tick 400 it has long expired and
    // asserting then would test nothing.
    const s = run(100, { 0: [build(4, 11, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBeGreaterThan(0)
  })

  it('lets the slow expire once the creep is out of range', () => {
    const s = run(400, { 0: [build(4, 11, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBe(0)
  })

  it('leaves a slowed creep behind an unslowed one', () => {
    const slowed = run(400, { 0: [build(4, 11, TowerKind.Slow, 0)], 1: [send(TANK, 1)] })
    const free = run(400, { 1: [send(TANK, 1)] })
    expect(slowed.lanes[0]!.creeps.x[0] as number).toBeLessThan(
      free.lanes[0]!.creeps.x[0] as number,
    )
  })

  it('splash damages several creeps from one shot', () => {
    const s = run(400, { 0: [build(2, 11, TowerKind.Splash, 0)], 1: [send(SWARM, 1)] })
    const alive = s.lanes[0]!.creeps.count
    const hurt = Array.from(s.lanes[0]!.creeps.hp.slice(0, alive)).filter((h) => h < 90)
    // Either several are damaged, or several already died from the splash.
    expect(hurt.length + s.players[0]!.kills).toBeGreaterThan(1)
  })

  it('only defends its own lane', () => {
    // A tower in lane 0 must never shoot a creep in lane 1.
    const s = run(600, {
      0: [build(3, 11, TowerKind.Single, 0)],
      1: [send(RUNNER, 0)], // player 0 sends -> creeps land in lane 1
    })
    expect(s.lanes[1]!.creeps.count).toBe(1)
    expect(s.lanes[1]!.creeps.hp[0] as number).toBe(220)
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
      2: [build(8, 11, TowerKind.Single, 0)],
      6: [build(12, 12, TowerKind.Splash, 0)],
      9: [build(16, 11, TowerKind.Slow, 0)],
      20: [send(SWARM, 1)],
      60: [send(RUNNER, 1)],
      90: [send(SWARM, 0)],
    }
    expect(hashState(run(900, cmds))).toBe(hashState(run(900, cmds)))
  })
})
