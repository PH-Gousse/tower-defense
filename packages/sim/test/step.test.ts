import { describe, it, expect } from 'vitest'
import { createState, type GameState } from '../src/state'
import { step, canBuild, Kind, DEFAULT_CONFIG, type Command } from '../src/step'
import { GRID_W, GRID_H, tileIndex, SPAWN_INDICES } from '../src/grid'
import { UNREACHABLE, buildField } from '../src/field'
import { hashState } from '../src/hash'

/** Run n ticks with an optional command schedule, returning the final state. */
function run(
  ticks: number,
  cmdsAt: Record<number, Command[]> = {},
  config = DEFAULT_CONFIG,
): GameState {
  let a = createState()
  let b = createState()
  for (let t = 0; t < ticks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b, config)
    b = a
    a = out
  }
  return a
}

const build = (x: number, y: number, player: 0 | 1 = 0): Command => ({
  tick: 0,
  player,
  kind: Kind.Build,
  x,
  y,
})

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
    const s = run(7)
    expect(s.tick).toBe(7)
  })

  it('releases one creep every spawnEveryTicks, alternating spawn tiles', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 4, spawnEveryTicks: 4 }
    // 16 ticks releases at t=4,8,12,16.
    const s = run(16, {}, config)
    expect(s.lane.creeps.count).toBe(4)
    // Alternating tiles means y differs between consecutive releases. Creeps
    // that spawn on the same tick at the same tile never separate, and one
    // splash hit would kill all of them.
    const ys = Array.from(s.lane.creeps.y.slice(0, 4))
    expect(ys[0]).not.toBe(ys[1])
    expect(ys[0]).toBe(ys[2])
  })

  it('walks a creep toward the exit', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepSpeed: 0.5 }
    const early = run(10, {}, config)
    const late = run(40, {}, config)
    expect(early.lane.creeps.count).toBe(1)
    expect(late.lane.creeps.x[0] as number).toBeGreaterThan(early.lane.creeps.x[0] as number)
  })

  it('refuses a placement that would seal the lane', () => {
    const s = createState()
    // Wall off all but one tile of a column, then check the last one is refused.
    for (let y = 0; y < GRID_H; y++) {
      if (y === 5) continue
      s.lane.blocked[tileIndex({ x: 20, y })] = 1
    }
    expect(canBuild(s, 20, 5)).toBe(false)
  })

  it('allows a placement that only lengthens the maze', () => {
    const s = createState()
    for (let y = 0; y < GRID_H; y++) {
      if (y === 5 || y === 6) continue
      s.lane.blocked[tileIndex({ x: 20, y })] = 1
    }
    expect(canBuild(s, 20, 5)).toBe(true)
  })

  it('refuses building on spawn, exit, or an occupied tile', () => {
    const s = createState()
    expect(canBuild(s, 0, 11)).toBe(false)
    expect(canBuild(s, GRID_W - 1, 11)).toBe(false)
    s.lane.blocked[tileIndex({ x: 8, y: 8 })] = 1
    expect(canBuild(s, 8, 8)).toBe(false)
  })

  it('refuses building out of bounds', () => {
    const s = createState()
    expect(canBuild(s, -1, 5)).toBe(false)
    expect(canBuild(s, GRID_W, 5)).toBe(false)
    expect(canBuild(s, 5, GRID_H)).toBe(false)
  })

  it('applies commands in (player, kind) order regardless of arrival order', () => {
    const forward = run(3, { 0: [build(5, 5, 0), build(6, 6, 1)] })
    const reversed = run(3, { 0: [build(6, 6, 1), build(5, 5, 0)] })
    expect(hashState(forward)).toBe(hashState(reversed))
  })

  it('teleports a creep back to spawn when its tile loses all paths', () => {
    const config = { ...DEFAULT_CONFIG, spawnTotal: 1, creepSpeed: 0.5 }
    let a = createState()
    let b = createState()
    for (let t = 0; t < 30; t++) {
      const out = step(a, [], b, config)
      b = a
      a = out
    }
    const walked = a.lane.creeps.x[0] as number
    expect(walked).toBeGreaterThan(1.5)

    // Seal the whole lane behind and ahead of the creep by hand, bypassing
    // canBuild — this is the state the teleport exists to recover from.
    for (let y = 0; y < GRID_H; y++) {
      a.lane.blocked[tileIndex({ x: Math.floor(walked) + 1, y })] = 1
      a.lane.blocked[tileIndex({ x: Math.floor(walked) - 1, y })] = 1
    }
    buildField(a.lane.blocked, a.lane.field)
    expect(a.lane.field.dist[tileIndex({ x: Math.floor(walked), y: 11 })]).toBe(UNREACHABLE)

    const after = step(a, [], b, config)
    // Back at a spawn tile, not stuck mid-field.
    expect(after.lane.creeps.x[0] as number).toBeLessThan(1)
  })

  it('is reproducible: same commands, same hash', () => {
    const cmds = { 2: [build(10, 10)], 5: [build(11, 11)], 9: [build(12, 12)] }
    expect(hashState(run(20, cmds))).toBe(hashState(run(20, cmds)))
  })
})
