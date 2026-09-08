import { describe, it, expect } from 'vitest'
import { createState } from '../src/state'
import { step, canBuild, checkBuild, Refusal } from '../src/step'
import { GRID_W, GRID_H, tileIndex } from '../src/grid'
import { UNREACHABLE, buildField, mazeLength } from '../src/field'
import { hashState } from '../src/hash'
import { TowerKind } from '../src/data'
import { build, send, run, tick, SWARM, RUNNER, TANK } from './helpers'

describe('step', () => {
  it('does not mutate the previous state', () => {
    const prev = createState()
    const into = createState()
    const before = hashState(prev)
    step(prev, [build(5, 5)], into)
    expect(hashState(prev)).toBe(before)
    expect(prev.tick).toBe(0)
  })

  it('advances the tick by exactly one', () => {
    expect(run(7).tick).toBe(7)
  })

  it('is reproducible: same commands, same hash', () => {
    const cmds = { 2: [build(10, 10)], 5: [send(RUNNER)], 9: [build(12, 12)] }
    expect(hashState(run(60, cmds))).toBe(hashState(run(60, cmds)))
  })
})

describe('sends and the spawn queue', () => {
  it('puts creeps in the opponent lane, never the sender own lane', () => {
    // A creep is owned by its sender for scoring but exists only in the
    // defender's lane. Player 1 sends, so lane 0 fills and lane 1 stays empty.
    const s = run(30, { 0: [send(RUNNER, 1)] })
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[1]!.creeps.count).toBe(0)
    expect(s.lanes[0]!.creeps.owner[0]).toBe(1)
  })

  it('releases one creep at a time rather than all at once', () => {
    // A swarm send is 6 creeps. Released together at the same tile they would
    // never separate, so they would travel as a single point and one splash hit
    // would kill all six.
    const early = run(6, { 0: [send(SWARM)] })
    const later = run(40, { 0: [send(SWARM)] })
    expect(early.lanes[0]!.creeps.count).toBeLessThan(6)
    expect(early.lanes[0]!.creeps.count).toBeGreaterThan(0)
    expect(later.lanes[0]!.creeps.count).toBe(6)
  })

  it('alternates spawn tiles so consecutive releases separate', () => {
    const s = run(40, { 0: [send(SWARM)] })
    const ys = Array.from(s.lanes[0]!.creeps.y.slice(0, 4))
    expect(ys[0]).not.toBe(ys[1])
    expect(ys[0]).toBe(ys[2])
  })

  it('walks a creep toward the exit', () => {
    const early = run(40, { 0: [send(RUNNER)] })
    const late = run(200, { 0: [send(RUNNER)] })
    expect(late.lanes[0]!.creeps.x[0] as number).toBeGreaterThan(
      early.lanes[0]!.creeps.x[0] as number,
    )
  })
})

describe('placement', () => {
  it('refuses a placement that would seal the lane', () => {
    const s = createState()
    for (let y = 0; y < GRID_H; y++) {
      if (y === 5) continue
      s.lanes[0]!.blocked[tileIndex({ x: 20, y })] = 1
    }
    expect(canBuild(s, 0, 20, 5)).toBe(false)
    expect(checkBuild(s, 0, 20, 5).refusal).toBe(Refusal.WouldSealLane)
  })

  it('allows a placement that only lengthens the maze', () => {
    const s = createState()
    for (let y = 0; y < GRID_H; y++) {
      if (y === 5 || y === 6) continue
      s.lanes[0]!.blocked[tileIndex({ x: 20, y })] = 1
    }
    expect(canBuild(s, 0, 20, 5)).toBe(true)
  })

  it('names why, rather than just refusing', () => {
    const s = createState()
    expect(checkBuild(s, 0, -1, 5).refusal).toBe(Refusal.OutOfBounds)
    expect(checkBuild(s, 0, 0, 11).refusal).toBe(Refusal.SpawnOrExit)
    expect(checkBuild(s, 0, GRID_W - 1, 12).refusal).toBe(Refusal.SpawnOrExit)
    s.lanes[0]!.blocked[tileIndex({ x: 8, y: 8 })] = 1
    expect(checkBuild(s, 0, 8, 8).refusal).toBe(Refusal.Occupied)
  })

  it('reports the resulting maze length when allowed', () => {
    const s = createState()
    const before = mazeLength(s.lanes[0]!.field)
    const check = checkBuild(s, 0, 20, 11)
    expect(check.refusal).toBe(Refusal.None)
    expect(check.mazeAfter).toBeGreaterThan(before)
  })

  it('leaves state untouched — the probe must not mutate', () => {
    const s = createState()
    const before = hashState(s)
    checkBuild(s, 0, 20, 11)
    checkBuild(s, 0, 20, 5)
    checkBuild(s, 0, -5, -5)
    expect(hashState(s)).toBe(before)
  })

  it('builds only in your own lane', () => {
    const s = run(3, {
      0: [build(5, 5, TowerKind.Single, 0), build(9, 9, TowerKind.Single, 1)],
    })
    expect(s.lanes[0]!.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(TowerKind.Single)
    expect(s.lanes[0]!.towers.kind[tileIndex({ x: 9, y: 9 })]).toBe(-1)
    expect(s.lanes[1]!.towers.kind[tileIndex({ x: 9, y: 9 })]).toBe(TowerKind.Single)
  })
})

describe('command ordering', () => {
  it('applies in (player, kind) order regardless of arrival order', () => {
    const forward = run(3, {
      0: [build(5, 5, TowerKind.Single, 0), build(6, 6, TowerKind.Single, 1)],
    })
    const reversed = run(3, {
      0: [build(6, 6, TowerKind.Single, 1), build(5, 5, TowerKind.Single, 0)],
    })
    expect(hashState(forward)).toBe(hashState(reversed))
  })
})

describe('teleport', () => {
  it('returns a pathless creep to the spawn', () => {
    let s = run(120, { 0: [send(TANK)] })
    const walked = s.lanes[0]!.creeps.x[0] as number
    expect(walked).toBeGreaterThan(1.5)

    // Seal the lane by hand on both sides of the creep, bypassing canBuild.
    // This is the state the teleport exists to recover from.
    const col = Math.floor(walked)
    for (let y = 0; y < GRID_H; y++) {
      s.lanes[0]!.blocked[tileIndex({ x: col + 1, y })] = 1
      s.lanes[0]!.blocked[tileIndex({ x: col - 1, y })] = 1
    }
    buildField(s.lanes[0]!.blocked, s.lanes[0]!.field)
    expect(s.lanes[0]!.field.dist[tileIndex({ x: col, y: 11 })]).toBe(UNREACHABLE)

    s = tick(s)
    expect(s.lanes[0]!.creeps.x[0] as number).toBeLessThan(1)
  })
})
