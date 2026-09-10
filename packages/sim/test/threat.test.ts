import { describe, it, expect } from 'vitest'
import { createState, type GameState } from '../src/state'
import { buildField } from '../src/field'
import { tileIndex, TILE_COUNT } from '../src/grid'
import { templateAt } from '../src/maze'
import { TowerKind, CREEPS } from '../src/data'
import { hashState } from '../src/hash'
import { floodLeaks, laneThreat, waveLeaks, routeOf, population } from '../src/threat'
import { step, Kind, type Command } from '../src/step'
import { SWARM, TANK, withoutBuildPhase } from './helpers'

withoutBuildPhase()

/**
 * The maze-strength model the bot reads the board with.
 *
 * A heuristic cannot be pinned to a number, so these pin its SHAPE: the
 * directions it must move in, the cases where it must say zero, and the one
 * calibration that matters -- that a flood of tanks leaks against single
 * target towers and a flood of swarm does not against mortars, because that
 * is the measured truth of the sim and the whole reason the bot reads the
 * board this way instead of from a table.
 */

/** Lane 1 of a fresh state, fortified along template 1 with `kinds`. */
function fortified(kinds: readonly (TowerKind | -1)[], level = 1): GameState {
  const s = createState()
  const lane = s.lanes[1]!
  const tiles = templateAt(1).tiles
  kinds.forEach((k, i) => {
    const idx = tileIndex(tiles[i]!)
    lane.blocked[idx] = 1
    if (k === -1) return
    lane.towers.kind[idx] = k
    lane.towers.level[idx] = level
  })
  buildField(lane.blocked, lane.field)
  return s
}

const singles = (n: number) => Array.from({ length: n }, () => TowerKind.Single)
const mix = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 5 === 3 ? TowerKind.Splash : i % 5 === 4 ? TowerKind.Slow : TowerKind.Single))

function leaksOf(s: GameState, creep: number, count: number): number {
  const lane = s.lanes[1]!
  const counts = new Int32Array(CREEPS.length)
  counts[creep] = count
  return floodLeaks(routeOf(lane), lane.towers.kind, lane.towers.level, counts)
}

describe('floodLeaks', () => {
  it('is zero for an empty lane and for an empty route', () => {
    const s = fortified(singles(12))
    expect(leaksOf(s, TANK, 0)).toBe(0)
    const counts = new Int32Array(CREEPS.length)
    counts[TANK] = 50
    expect(floodLeaks([], s.lanes[1]!.towers.kind, s.lanes[1]!.towers.level, counts)).toBe(0)
  })

  it('never exceeds the crowd and never goes negative', () => {
    const s = fortified(singles(6))
    for (const n of [1, 10, 100, 1000]) {
      const l = leaksOf(s, TANK, n)
      expect(l).toBeGreaterThanOrEqual(0)
      expect(l).toBeLessThanOrEqual(n)
    }
  })

  it('leaks less as the maze grows', () => {
    const a = leaksOf(fortified(singles(6)), TANK, 200)
    const b = leaksOf(fortified(singles(20)), TANK, 200)
    const c = leaksOf(fortified(singles(40)), TANK, 200)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })

  it('leaks less as towers level up', () => {
    const a = leaksOf(fortified(singles(20), 1), TANK, 200)
    const b = leaksOf(fortified(singles(20), 3), TANK, 200)
    expect(b).toBeLessThan(a)
  })

  it('leaks more as the crowd grows', () => {
    const s = fortified(singles(20))
    expect(leaksOf(s, TANK, 300)).toBeGreaterThan(leaksOf(s, TANK, 100))
  })

  it('knows splash answers numbers: swarm floods die to mortars and not to guard towers', () => {
    // The measured truth this model exists to encode. Twenty single-target
    // towers killed 1279 of 2596 streamed swarm -- one per shot, about 410
    // shots a lap between them -- while four mortars killed every one.
    const guards = fortified(singles(20))
    const mortarsOnly = fortified(mix(20).map((k) => (k === TowerKind.Splash ? k : -1)))
    expect(leaksOf(guards, SWARM, 800)).toBeGreaterThan(300)
    expect(leaksOf(mortarsOnly, SWARM, 800)).toBe(0)
  })

  it('knows a tank flood walks through single-target fire', () => {
    // Twenty guard towers killed 122 of 880 streamed tanks in the sim.
    expect(leaksOf(fortified(singles(20)), TANK, 300)).toBeGreaterThan(150)
  })

  it('costs a candidate through the override exactly as building it would', () => {
    const s = fortified(mix(12))
    const lane = s.lanes[1]!
    const tile = tileIndex(templateAt(1).tiles[12]!)
    const counts = new Int32Array(CREEPS.length)
    counts[TANK] = 200
    const route = routeOf(lane)
    const viaOverride = floodLeaks(route, lane.towers.kind, lane.towers.level, counts, {
      tile,
      kind: TowerKind.Splash,
      level: 1,
    })
    lane.towers.kind[tile] = TowerKind.Splash
    lane.towers.level[tile] = 1
    const built = floodLeaks(route, lane.towers.kind, lane.towers.level, counts)
    expect(viaOverride).toBe(built)
  })
})

describe('laneThreat and waveLeaks', () => {
  it('read the lane\'s population by roster entry', () => {
    let s = fortified(singles(6))
    ;(s.players[0] as { gold: number }).gold = 1e9
    const into = createState()
    const cmds: Command[] = []
    for (let i = 0; i < 5; i++) cmds.push({ tick: 0, player: 0, kind: Kind.Send, creep: TANK })
    for (let i = 0; i < 3; i++) cmds.push({ tick: 0, player: 0, kind: Kind.Send, creep: SWARM })
    s = step(s, cmds, into)
    const pop = new Int32Array(CREEPS.length)
    expect(population(s.lanes[1]!, pop)).toBe(8)
    expect(pop[TANK]).toBe(5)
    expect(pop[SWARM]).toBe(3)
  })

  it('a wave adds leaks on top of the lane, never below zero', () => {
    const s = fortified(singles(12))
    const lane = s.lanes[1]!
    const route = routeOf(lane)
    expect(laneThreat(lane, route)).toBe(0)
    const w = waveLeaks(lane, route, TANK, 22)
    expect(w).toBeGreaterThanOrEqual(0)
    expect(waveLeaks(lane, route, TANK, 200)).toBeGreaterThan(w)
  })

  it('reads state without writing it', () => {
    const s = fortified(mix(20))
    const before = hashState(s)
    const lane = s.lanes[1]!
    const route = routeOf(lane)
    laneThreat(lane, route, { tile: tileIndex(templateAt(1).tiles[20]!), kind: TowerKind.Slow, level: 2 })
    waveLeaks(lane, route, TANK, 50)
    expect(hashState(s)).toBe(before)
    expect(lane.towers.kind.length).toBe(TILE_COUNT)
  })
})
