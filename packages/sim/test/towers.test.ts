import { describe, it, expect } from 'vitest'
import { createSpatialHash, rebuildHash, findTarget, tileOf, HASH_COUNT } from '../src/towers'
import { createState } from '../src/state'
import { buildField, UNREACHABLE } from '../src/field'
import { TowerKind, levelOf, ARCHETYPES, ACQUIRE_TICKS, creepSpec } from '../src/data'
import { hashState } from '../src/hash'
import {
  GRID_W,
  GRID_H,
  BUILD_ROW_MIN,
  BUILD_ROW_MAX,
  TOWER_SIZE,
  footprintCentreX,
  footprintCentreY,
  footprintInBuildArea,
} from '../src/grid'
import { insertTower, footprintOverlapsTower } from '../src/state'
import { step } from '../src/step'
import { build, send, run, runUntil, stepper, R, SCRAPLING, DASHER_HOUND, BOG_BRUTE, withEveryCreepUnlocked } from './helpers'

// Not a test of the opening or the unlock clock: see withEveryCreepUnlocked.
withEveryCreepUnlocked()

describe('spatial hash', () => {
  it('buckets creeps by cell, ascending within a bucket', () => {
    // Stability is the targeting tiebreak: within a bucket, ascending
    // creep-array index means ascending id.
    const wave = Array.from({ length: 30 }, () => send(SCRAPLING, 1))
    const s = run(60, { 0: wave })
    const hash = createSpatialHash(2048)
    rebuildHash(s.lanes[0]!, hash)

    let seen = 0
    for (let t = 0; t < HASH_COUNT; t++) {
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

/**
 * A tiny LCG for laying out random boards. Test-side only: the sim itself
 * draws no randomness, and this is a test of the hash against brute force, not
 * of any particular board.
 */
function lcg(seed: number): () => number {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 4294967296
  }
}

describe('targeting', () => {
  it('through the hash equals a brute-force scan, on random boards', () => {
    // The hash must only ever change the cost of the question, never the
    // answer. Random anchors, random creep positions, random ranges -- and the
    // brute force is written the way the rule reads: in range, lowest dist,
    // lowest id.
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = lcg(seed)
      const s = createState()
      const lane = s.lanes[0]!
      let placed = 0
      for (let tries = 0; tries < 400 && placed < 60; tries++) {
        const ax = Math.floor(rnd() * (GRID_W - TOWER_SIZE + 1))
        const ay = BUILD_ROW_MIN + Math.floor(rnd() * 60)
        if (!footprintInBuildArea(ax, ay) || footprintOverlapsTower(lane, ax, ay)) continue
        insertTower(lane, placed + 1, ax, ay, Math.floor(rnd() * 3))
        placed += 1
      }
      buildField(lane.blocked, lane.field)
      const c = lane.creeps
      const n = 300
      for (let i = 0; i < n; i++) {
        c.id[i] = i + 1
        c.x[i] = rnd() * GRID_W
        c.y[i] = rnd() * (BUILD_ROW_MIN + 70)
        c.hp[i] = rnd() < 0.1 ? 0 : 10
      }
      c.count = n
      const hash = createSpatialHash(n)
      rebuildHash(lane, hash)

      for (let slot = 0; slot < lane.towers.count; slot++) {
        const range = 1 + rnd() * 12
        const tx = footprintCentreX(lane.towers.anchorX[slot] as number)
        const ty = footprintCentreY(lane.towers.anchorY[slot] as number)
        let best = -1
        let bestDist = UNREACHABLE
        let bestId = 0
        for (let i = 0; i < n; i++) {
          if ((c.hp[i] as number) <= 0) continue
          const dx = (c.x[i] as number) - tx
          const dy = (c.y[i] as number) - ty
          if (dx * dx + dy * dy > range * range) continue
          const d = lane.field.dist[tileOf(c.x[i] as number, c.y[i] as number)] as number
          const id = c.id[i] as number
          if (d < bestDist || (d === bestDist && id < bestId)) {
            best = i
            bestDist = d
            bestId = id
          }
        }
        expect(findTarget(lane, hash, slot, range), `seed ${seed} slot ${slot}`).toBe(best)
      }
    }
  })

  it('measures range from the footprint centre', () => {
    // A creep exactly `range` from the centre is in range; one exactly `range`
    // from the anchor but further from the centre is not.
    const s = createState()
    const lane = s.lanes[0]!
    insertTower(lane, 1, 6, R + 10, TowerKind.Single)
    buildField(lane.blocked, lane.field)
    const range = 3
    const c = lane.creeps
    c.count = 2
    c.id[0] = 1
    c.x[0] = footprintCentreX(6) + range
    c.y[0] = footprintCentreY(R + 10)
    c.hp[0] = 10
    c.id[1] = 2
    c.x[1] = 6 - range
    c.y[1] = R + 10
    c.hp[1] = 10
    const hash = createSpatialHash(2)
    rebuildHash(lane, hash)
    expect(findTarget(lane, hash, 0, range)).toBe(0)
    c.hp[0] = 0
    rebuildHash(lane, hash)
    expect(findTarget(lane, hash, 0, range)).toBe(-1)
  })
})

describe('towers', () => {
  it('kills a creep that walks into range', () => {
    // Two towers on the left edge. The runner spawns in column 0, is routed
    // around them, and passes inside range on the way.
    const s = runUntil((x) => x.players[0]!.kills > 0, 4000, {
      0: [build(0, R + 4, TowerKind.Single, 0)],
      1: [build(0, R + 6, TowerKind.Single, 0)],
      2: [send(DASHER_HOUND, 1)],
    })
    expect(s.players[0]!.kills).toBeGreaterThan(0)
  })

  it('leaves a creep alive when it out-tanks the maze', () => {
    // A tank against a single tower: damaged, but it completes a lap.
    // Asserted against the lap rather than against a tick budget, because
    // "alive after N ticks" is a statement about the roster, not about towers.
    const lapTicks = Math.ceil(GRID_H / creepSpec(BOG_BRUTE).speed)
    const s = runUntil(
      (x) => x.players[0]!.leaks > 0,
      lapTicks * 2,
      { 0: [build(0, R + 4, TowerKind.Single, 0)], 1: [send(BOG_BRUTE, 1)] },
    )
    expect(s.players[0]!.leaks).toBeGreaterThan(0)
    expect(s.players[0]!.kills).toBe(0)
    expect(s.lanes[0]!.creeps.count).toBe(1)
    // Damaged on the way round, read from the roster rather than a literal.
    expect(s.lanes[0]!.creeps.hp[0] as number).toBeLessThan(creepSpec(BOG_BRUTE).hp)
  })

  it('respects cooldown rather than firing every tick', () => {
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    const dmg = levelOf(TowerKind.Single, 1).damage
    const ticks = 600
    const s = run(ticks, { 0: [build(0, R + 2, TowerKind.Single, 0)], 1: [send(BOG_BRUTE, 1)] })
    const dealt = creepSpec(BOG_BRUTE).hp - (s.lanes[0]!.creeps.hp[0] as number)
    expect(dealt).toBeGreaterThan(0)
    expect(dealt).toBeLessThanOrEqual((ticks / cd + 2) * dmg)
  })

  it('applies a slow while the creep is in range', () => {
    const s = runUntil(
      (x) => (x.lanes[0]!.creeps.slowPercent[0] as number) > 0,
      1500,
      { 0: [build(0, R, TowerKind.Slow, 0)], 1: [send(BOG_BRUTE, 1)] },
    )
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBeGreaterThan(0)
  })

  it('lets the slow expire once the creep is out of range', () => {
    // Well past the tower: a tank walks about 60 rows in 1200 ticks.
    const s = run(1200, { 0: [build(0, R, TowerKind.Slow, 0)], 1: [send(BOG_BRUTE, 1)] })
    expect(s.lanes[0]!.creeps.y[0] as number).toBeGreaterThan(R + 20)
    expect(s.lanes[0]!.creeps.slowPercent[0] as number).toBe(0)
  })

  it('leaves a slowed creep behind an unslowed one', () => {
    // Build beside the column the tank actually walks. Spawns are scattered
    // (ADR-0030), and a shrine at x = 0 only reached this tank while ranges were
    // 6.75 tiles; at the 2026-09-16 rework's 5.47 it never slowed it, and both
    // creeps finished on the identical y -- a test of the spawn table, not the slow.
    const column = Math.floor(run(1, { 0: [send(BOG_BRUTE, 1)] }).lanes[0]!.creeps.x[0] as number)
    const anchor = Math.min(Math.max(column + 1, 0), GRID_W - TOWER_SIZE)
    const slowed = run(600, { 0: [build(anchor, R, TowerKind.Slow, 0)], 1: [send(BOG_BRUTE, 1)] })
    const free = run(600, { 1: [send(BOG_BRUTE, 1)] })
    // Down the lane is +y, so "behind" is a smaller y.
    expect(slowed.lanes[0]!.creeps.y[0] as number).toBeLessThan(
      free.lanes[0]!.creeps.y[0] as number,
    )
  })

  it('splash damages several creeps from one shot', () => {
    // Placed by hand rather than walked in. Before ADR-0025 the closest a
    // walking creep ever passed a tower was 1.5 tiles, exactly the level-1
    // splash range, and a walked-in version of this test sat on that knife
    // edge. The range is 4.5 now, but this test is about the splash rule, not
    // about ranges: four creeps stand inside range, clustered within the
    // blast radius, and one shot hurts them all.
    const s = createState()
    const lane = s.lanes[0]!
    insertTower(lane, 1, 4, R + 4, TowerKind.Splash)
    buildField(lane.blocked, lane.field)
    const cx = footprintCentreX(4)
    const cy = footprintCentreY(R + 4)
    const c = lane.creeps
    const at = [[1.3, -0.3], [1.3, 0], [1.3, 0.3], [1.4, 0.1]]
    c.count = at.length
    for (let i = 0; i < at.length; i++) {
      c.id[i] = i + 1
      c.x[i] = cx + (at[i]![0] as number)
      c.y[i] = cy + (at[i]![1] as number)
      c.hp[i] = creepSpec(SCRAPLING).hp * 10
      c.speed[i] = 0
      c.spec[i] = SCRAPLING
    }
    // Already locked on: the acquisition delay is its own test below.
    lane.towers.acquire[0] = 0
    const after = step(s, [], createState())
    const full = creepSpec(SCRAPLING).hp * 10
    const dmg = levelOf(TowerKind.Splash, 1).damage
    for (let i = 0; i < at.length; i++) expect(after.lanes[0]!.creeps.hp[i], `creep ${i}`).toBe(full - dmg)
  })

  it('only defends its own lane', () => {
    // A tower in lane 0 must never shoot a creep in lane 1.
    const s = run(600, {
      0: [build(0, R + 4, TowerKind.Single, 0)],
      1: [send(DASHER_HOUND, 0)], // player 0 sends -> creeps land in lane 1
    })
    expect(s.lanes[1]!.creeps.count).toBe(1)
    expect(s.lanes[1]!.creeps.hp[0] as number).toBe(creepSpec(DASHER_HOUND).hp)
    expect(s.players[1]!.kills).toBe(0)
  })

  it('fires in anchor order: the tower list is sorted', () => {
    // Two single-target towers both in range of one creep with one shot of
    // HP: the tower with the lower anchor fires first and takes the kill; the
    // other finds nothing to shoot. Observable as which tower is on cooldown.
    // Inserted high anchor first, so the order is the sort's doing.
    const s = createState()
    const lane = s.lanes[0]!
    insertTower(lane, 1, 4, R + 4, TowerKind.Single)
    insertTower(lane, 2, 0, R + 4, TowerKind.Single)
    buildField(lane.blocked, lane.field)
    expect(lane.towers.anchorX[0]).toBe(0)
    expect(lane.towers.id[0]).toBe(2)
    lane.creeps.count = 1
    lane.creeps.id[0] = 1
    lane.creeps.x[0] = 3
    lane.creeps.y[0] = footprintCentreY(R + 4)
    lane.creeps.hp[0] = 1
    lane.creeps.speed[0] = 0
    lane.creeps.spec[0] = SCRAPLING
    const hash = createSpatialHash(1)
    rebuildHash(lane, hash)
    expect(findTarget(lane, hash, 0, 3)).toBe(0)
    expect(findTarget(lane, hash, 1, 3)).toBe(0)
    // Both locked on, so the order alone decides who shoots.
    lane.towers.acquire[0] = 0
    lane.towers.acquire[1] = 0
    const after = step(s, [], createState())
    expect(after.players[0]!.kills).toBe(1)
    expect(after.lanes[0]!.towers.cooldown[0]).toBe(levelOf(TowerKind.Single, 1).cooldownTicks)
    expect(after.lanes[0]!.towers.cooldown[1]).toBe(0)
  })
})

describe('acquisition delay (ADR-0028)', () => {
  /** One tower, one creep standing still inside its range, nothing else. */
  function standoff(): { s: ReturnType<typeof createState>; hp: number } {
    const s = createState()
    const lane = s.lanes[0]!
    insertTower(lane, 1, 4, R + 4, TowerKind.Single)
    buildField(lane.blocked, lane.field)
    const c = lane.creeps
    c.count = 1
    c.id[0] = 1
    c.x[0] = footprintCentreX(4) + 2
    c.y[0] = footprintCentreY(R + 4)
    c.hp[0] = 1e6
    c.speed[0] = 0
    c.spec[0] = BOG_BRUTE
    return { s, hp: 1e6 }
  }

  function damageAfter(ticks: number): number {
    let { s } = standoff()
    const { hp } = standoff()
    const next = stepper(s)
    for (let t = 0; t < ticks; t++) s = next()
    return hp - (s.lanes[0]!.creeps.hp[0] as number)
  }

  it('is a whole number of ticks in the data', () => {
    expect(Number.isInteger(ACQUIRE_TICKS)).toBe(true)
    expect(ACQUIRE_TICKS).toBeGreaterThan(0)
  })

  it('holds fire for acquireTicks after a creep first comes into range', () => {
    // A new tower with a creep already in range: nothing for ACQUIRE_TICKS
    // ticks, then the first shot on the tick after.
    const dmg = levelOf(TowerKind.Single, 1).damage
    expect(damageAfter(ACQUIRE_TICKS)).toBe(0)
    expect(damageAfter(ACQUIRE_TICKS + 1)).toBe(dmg)
  })

  it('stays locked on: the second shot follows the cooldown with no second wait', () => {
    const dmg = levelOf(TowerKind.Single, 1).damage
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    expect(damageAfter(ACQUIRE_TICKS + 1 + cd)).toBe(dmg)
    expect(damageAfter(ACQUIRE_TICKS + 2 + cd)).toBe(2 * dmg)
  })

  it('waits again once it has had a tick with nothing to shoot', () => {
    const dmg = levelOf(TowerKind.Single, 1).damage
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    let { s } = standoff()
    const next = stepper(s)
    for (let t = 0; t < ACQUIRE_TICKS + 1; t++) s = next()
    expect(1e6 - (s.lanes[0]!.creeps.hp[0] as number)).toBe(dmg)
    // Out of range for the whole cooldown and one idle tick beyond it.
    const back = s.lanes[0]!.creeps.x[0] as number
    s.lanes[0]!.creeps.x[0] = back + 30
    const away = stepper(s)
    for (let t = 0; t < cd + 1; t++) s = away()
    expect(s.lanes[0]!.towers.acquire[0]).toBe(ACQUIRE_TICKS)
    // Back in range: the full delay again before the next shot.
    s.lanes[0]!.creeps.x[0] = back
    const again = stepper(s)
    for (let t = 0; t < ACQUIRE_TICKS; t++) s = again()
    expect(1e6 - (s.lanes[0]!.creeps.hp[0] as number)).toBe(dmg)
    s = again()
    expect(1e6 - (s.lanes[0]!.creeps.hp[0] as number)).toBe(2 * dmg)
  })

  it('does not count down while cooling down', () => {
    // Between shots the counter stays at zero: cooldown and wind-up are one
    // integer each and never overlap.
    let { s } = standoff()
    const next = stepper(s)
    for (let t = 0; t < ACQUIRE_TICKS + 1; t++) s = next()
    expect(s.lanes[0]!.towers.cooldown[0]).toBe(levelOf(TowerKind.Single, 1).cooldownTicks)
    expect(s.lanes[0]!.towers.acquire[0]).toBe(0)
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

describe('the tower rework (user, 2026-09-16)', () => {
  // Gold is stored at x10 (see creeps.json _scaleComment), so 10 gold is 100.
  const GOLD = 10
  // The original's units: 64 to a creep tile (ADR-0025).
  const UNITS_PER_TILE = 64
  // Sixty shots a minute at 20 Hz.
  const ONE_SHOT_A_SECOND = 20

  it('prices every level-1 tower at 10 gold and fires it once a second', () => {
    for (const kind of [TowerKind.Single, TowerKind.Splash, TowerKind.Slow]) {
      expect(levelOf(kind, 1).cost, ARCHETYPES[kind]!.name).toBe(10 * GOLD)
      expect(levelOf(kind, 1).cooldownTicks, ARCHETYPES[kind]!.name).toBe(ONE_SHOT_A_SECOND)
    }
  })

  it('gives the guard tower 10 damage at range 500', () => {
    expect(levelOf(TowerKind.Single, 1).damage).toBe(10)
    expect(levelOf(TowerKind.Single, 1).range * UNITS_PER_TILE).toBe(500)
  })

  it('gives the mortar 20 damage at range 150: twice the guard, for the same price', () => {
    expect(levelOf(TowerKind.Splash, 1).damage).toBe(20)
    expect(levelOf(TowerKind.Splash, 1).range * UNITS_PER_TILE).toBe(150)
  })

  it('names the towers as the player sees them', () => {
    expect(ARCHETYPES.map((a) => a.name)).toEqual(['Guard tower', 'Mortar', 'Frost shrine'])
  })

  it('lets a mortar reach the corridor beside its wall and nothing past it', () => {
    // 150 units is 2.34 tiles from the footprint centre: one tile of footprint,
    // then 1.34 tiles of reach. The user kept it knowing that; this pins the
    // consequence so a range change cannot quietly widen it.
    const reach = levelOf(TowerKind.Splash, 1).range - TOWER_SIZE / 2
    expect(reach).toBeGreaterThan(1)
    expect(reach).toBeLessThan(2)
  })
})

describe('determinism with towers and sends', () => {
  it('produces the same hash for the same commands', () => {
    const cmds = {
      2: [build(0, R + 4, TowerKind.Single, 0)],
      6: [build(2, R + 8, TowerKind.Splash, 0)],
      9: [build(4, R + 12, TowerKind.Slow, 0)],
      20: [send(SCRAPLING, 1)],
      60: [send(DASHER_HOUND, 1)],
      90: [send(SCRAPLING, 0)],
    }
    expect(hashState(run(900, cmds))).toBe(hashState(run(900, cmds)))
  })
})

export { BUILD_ROW_MAX }
