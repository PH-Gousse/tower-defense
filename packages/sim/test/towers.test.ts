import { describe, it, expect } from 'vitest'
import { createState, type GameState } from '../src/state'
import { step, Kind, Refusal, checkUpgrade, checkSell, sellValue, DEFAULT_CONFIG, type Command } from '../src/step'
import { TowerKind, levelOf, investedIn, SELL_REFUND, ARCHETYPES } from '../src/data'
import { createSpatialHash, rebuildHash } from '../src/towers'
import { tileIndex, GRID_W } from '../src/grid'
import { hashState } from '../src/hash'

function run(ticks: number, cmdsAt: Record<number, Command[]> = {}, config = DEFAULT_CONFIG): GameState {
  let a = createState()
  let b = createState()
  for (let t = 0; t < ticks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b, config)
    b = a
    a = out
  }
  return a
}

const build = (x: number, y: number, tower = TowerKind.Single): Command => ({
  tick: 0, player: 0, kind: Kind.Build, tower, x, y,
})
const upgrade = (x: number, y: number): Command => ({ tick: 0, player: 0, kind: Kind.Upgrade, x, y })
const sell = (x: number, y: number): Command => ({ tick: 0, player: 0, kind: Kind.Sell, x, y })

describe('spatial hash', () => {
  it('buckets creeps by tile, ascending within a bucket', () => {
    const s = run(40, {}, { ...DEFAULT_CONFIG, spawnTotal: 6, creepSpeed: 0.01 })
    const hash = createSpatialHash(2048)
    rebuildHash(s, hash)

    let seen = 0
    for (let t = 0; t < hash.bucketStart.length - 1; t++) {
      const from = hash.bucketStart[t] as number
      const to = hash.bucketStart[t + 1] as number
      for (let k = from + 1; k < to; k++) {
        // Stability is the targeting tiebreak: within a bucket, ascending
        // creep-array index means ascending id.
        expect(hash.bucketItems[k] as number).toBeGreaterThan(hash.bucketItems[k - 1] as number)
      }
      seen += to - from
    }
    expect(seen).toBe(s.lane.creeps.count)
  })
})

describe('towers', () => {
  it('kills a creep that walks into range', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepHp: 60, creepSpeed: 0.3 }
    const s = run(300, { 0: [build(6, 11)] }, config)
    expect(s.kills).toBe(1)
    expect(s.lane.creeps.count).toBe(0)
  })

  it('leaves a creep alive when it out-tanks the maze', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepHp: 100000, creepSpeed: 0.3 }
    const s = run(300, { 0: [build(6, 11)] }, config)
    expect(s.kills).toBe(0)
    expect(s.lane.creeps.count).toBe(1)
    // Damage persists: it took hits without dying.
    expect(s.lane.creeps.hp[0] as number).toBeLessThan(100000)
  })

  it('respects cooldown — a level 1 single-target does not fire every tick', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepHp: 100000, creepSpeed: 0.05 }
    const cd = levelOf(TowerKind.Single, 1).cooldownTicks
    const dmg = levelOf(TowerKind.Single, 1).damage
    const s = run(200, { 0: [build(3, 11)] }, config)
    const dealt = 100000 - (s.lane.creeps.hp[0] as number)
    // Well under what firing every tick would produce.
    expect(dealt).toBeLessThan((200 / cd + 2) * dmg)
    expect(dealt).toBeGreaterThan(0)
  })

  it('slow reduces speed while active and wears off', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepHp: 100000, creepSpeed: 0.3 }
    const slowed = run(160, { 0: [build(4, 11, TowerKind.Slow)] }, config)
    const free = run(160, {}, config)
    expect(slowed.lane.creeps.slowPercent[0] as number).toBeGreaterThan(0)
    // A slowed creep is behind one that walked unimpeded.
    expect(slowed.lane.creeps.x[0] as number).toBeLessThan(free.lane.creeps.x[0] as number)
  })

  it('splash damages several creeps from one shot', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 6, spawnEveryTicks: 1, creepHp: 100000, creepSpeed: 0.02 }
    const s = run(200, { 0: [build(2, 11, TowerKind.Splash)] }, config)
    const hurt = Array.from(s.lane.creeps.hp.slice(0, s.lane.creeps.count)).filter((h) => h < 100000)
    expect(hurt.length).toBeGreaterThan(1)
  })
})

describe('economy of building', () => {
  it('charges gold on build and refuses when short', () => {
    const s = createState()
    const cost = levelOf(TowerKind.Single, 1).cost
    const after = run(2, { 0: [build(5, 5)] })
    expect(after.gold).toBe(s.gold - cost)

    const broke = createState()
    broke.gold = cost - 1
    const b = createState()
    const out = step(broke, [build(5, 5)], b)
    expect(out.lane.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
    expect(out.gold).toBe(cost - 1)
  })

  it('upgrades through three levels then refuses', () => {
    let s = run(2, { 0: [build(5, 5)] })
    expect(s.lane.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(1)
    const b = createState()
    s = step(s, [upgrade(5, 5)], b)
    expect(s.lane.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(2)
    const c = createState()
    s = step(s, [upgrade(5, 5)], c)
    expect(s.lane.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(3)
    expect(checkUpgrade(s, 5, 5)).toBe(Refusal.AlreadyMaxLevel)
  })

  it('refuses upgrade and sell on an empty tile', () => {
    const s = createState()
    expect(checkUpgrade(s, 5, 5)).toBe(Refusal.NoTowerHere)
    expect(checkSell(s, 5, 5)).toBe(Refusal.NoTowerHere)
  })

  it('sell refunds a fraction of everything invested, and reopens the tile', () => {
    let s = run(2, { 0: [build(5, 5)] })
    const b = createState()
    s = step(s, [upgrade(5, 5)], b)
    const invested = investedIn(TowerKind.Single, 2)
    expect(sellValue(s, 5, 5)).toBe(Math.floor(invested * SELL_REFUND))

    const goldBefore = s.gold
    const c = createState()
    s = step(s, [sell(5, 5)], c)
    expect(s.gold).toBe(goldBefore + Math.floor(invested * SELL_REFUND))
    expect(s.lane.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
    expect(s.lane.blocked[tileIndex({ x: 5, y: 5 })]).toBe(0)
  })

  it('sell never seals the lane — removing an obstacle only opens paths', () => {
    // Wall the lane down to one gap, then sell a wall tile. Reachability can
    // only improve, which is why sell needs no candidate rebuild check.
    const cmds: Command[] = []
    for (let y = 0; y < 20; y++) cmds.push(build(20, y))
    let s = run(2, { 0: cmds })
    const before = s.lane.field.dist[tileIndex({ x: 0, y: 11 })] as number
    const b = createState()
    s = step(s, [sell(20, 5)], b)
    const after = s.lane.field.dist[tileIndex({ x: 0, y: 11 })] as number
    expect(after).toBeLessThanOrEqual(before)
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

  it('keeps sell refund below 1 so rebuilding is never free', () => {
    expect(SELL_REFUND).toBeGreaterThan(0)
    expect(SELL_REFUND).toBeLessThan(1)
  })
})

describe('determinism with towers', () => {
  it('produces the same hash for the same commands', () => {
    const cmds = {
      2: [build(8, 11, TowerKind.Single)],
      6: [build(12, 12, TowerKind.Splash)],
      9: [build(16, 11, TowerKind.Slow)],
      20: [upgrade(8, 11)],
      40: [sell(12, 12)],
    }
    const config = { ...DEFAULT_CONFIG, spawnTotal: 8, creepHp: 900 }
    expect(hashState(run(300, cmds, config))).toBe(hashState(run(300, cmds, config)))
  })

  it('applies build, upgrade and sell in kind order within a tick', () => {
    // Same tick, opposite arrival order: kind ascending means Build(1) before
    // Upgrade(2) before Sell(3), so both orderings must agree.
    const forward = run(5, { 0: [build(5, 5), upgrade(5, 5)] })
    const reversed = run(5, { 0: [upgrade(5, 5), build(5, 5)] })
    expect(hashState(forward)).toBe(hashState(reversed))
    expect(forward.lane.towers.level[tileIndex({ x: 5, y: 5 })]).toBe(2)
  })
})

export { GRID_W }
