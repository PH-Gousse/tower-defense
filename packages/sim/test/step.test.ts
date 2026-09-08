import { describe, it, expect } from 'vitest'
import { createState, spawnPointFor, type GameState } from '../src/state'
import { step, canBuild, checkBuild, Refusal } from '../src/step'
import { GRID_W, ENTRANCE_ROW, EXIT_ROW, tileIndex } from '../src/grid'
import { UNREACHABLE, buildField, mazeLength } from '../src/field'
import { hashState } from '../src/hash'
import { TowerKind } from '../src/data'
import { build, send, run, tick, SWARM, RUNNER, TANK, withoutBuildPhase } from './helpers'

// Not a test of the opening: see withoutBuildPhase.
withoutBuildPhase()

/**
 * Block a whole row of lane 0 by hand, leaving `gaps` open.
 *
 * Direct writes to `blocked`, bypassing canBuild: several of these set up
 * states the placement rules exist to prevent, which is the only way to test
 * that they prevent them.
 */
function wall(s: GameState, y: number, gaps: readonly number[]): void {
  for (let x = 0; x < GRID_W; x++) {
    if (!gaps.includes(x)) s.lanes[0]!.blocked[tileIndex({ x, y })] = 1
  }
}

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
    const cmds = { 2: [build(4, 10)], 5: [send(RUNNER)], 9: [build(5, 12)] }
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
    // Both spawn tiles sit on the entrance row, so the alternation is in x now
    // rather than in y. Release 0 and release 2 share a tile; 0 and 1 do not.
    expect(spawnPointFor(0)).not.toEqual(spawnPointFor(1))
    expect(spawnPointFor(0)).toEqual(spawnPointFor(2))

    // What that buys, which is the point: a swarm is six distinct points, not
    // one point that a single splash shot clears.
    const c = run(40, { 0: [send(SWARM)] }).lanes[0]!.creeps
    const seen = new Set<string>()
    for (let i = 0; i < 4; i++) seen.add(`${c.x[i]},${c.y[i]}`)
    expect(seen.size).toBe(4)
  })

  it('walks a creep toward the exit', () => {
    // The lane is vertical: the exit is at the bottom, so progress is +y. Both
    // samples are inside the first lap — a runner clears a bare lane in about
    // 200 ticks, and past that it has leaked and is back at the top.
    const early = run(40, { 0: [send(RUNNER)] })
    const late = run(120, { 0: [send(RUNNER)] })
    expect(late.lanes[0]!.creeps.y[0] as number).toBeGreaterThan(
      early.lanes[0]!.creeps.y[0] as number,
    )
  })
})

describe('placement', () => {
  it('refuses a placement that would seal the lane', () => {
    const s = createState()
    // A wall across the vertical lane with one column left open. Filling that
    // column is the sealing move.
    wall(s, 12, [5])
    expect(canBuild(s, 0, 5, 12)).toBe(false)
    expect(checkBuild(s, 0, 5, 12).refusal).toBe(Refusal.WouldSealLane)
  })

  it('allows a placement that only lengthens the maze', () => {
    const s = createState()
    // Two gaps: closing the near one leaves the far one, which is a detour
    // rather than a seal.
    wall(s, 12, [0, 6])
    expect(canBuild(s, 0, 6, 12)).toBe(true)
  })

  it('names why, rather than just refusing', () => {
    const s = createState()
    expect(checkBuild(s, 0, -1, 5).refusal).toBe(Refusal.OutOfBounds)
    // Both end rows are reserved in full, not just the four tiles creeps
    // actually appear on and drain through.
    expect(checkBuild(s, 0, 0, ENTRANCE_ROW).refusal).toBe(Refusal.SpawnOrExit)
    expect(checkBuild(s, 0, 5, ENTRANCE_ROW).refusal).toBe(Refusal.SpawnOrExit)
    expect(checkBuild(s, 0, GRID_W - 1, EXIT_ROW).refusal).toBe(Refusal.SpawnOrExit)
    expect(checkBuild(s, 0, 0, EXIT_ROW).refusal).toBe(Refusal.SpawnOrExit)
    s.lanes[0]!.blocked[tileIndex({ x: 4, y: 8 })] = 1
    expect(checkBuild(s, 0, 4, 8).refusal).toBe(Refusal.Occupied)
  })

  it('reports the resulting maze length when allowed', () => {
    const s = createState()
    // Gaps at both edges. The route takes the near one, so closing it is a
    // measurable detour rather than a no-op.
    wall(s, 12, [0, GRID_W - 1])
    const before = mazeLength(buildField(s.lanes[0]!.blocked))
    const check = checkBuild(s, 0, 0, 12)
    expect(check.refusal).toBe(Refusal.None)
    expect(check.mazeAfter).toBeGreaterThan(before)
  })

  it('leaves state untouched — the probe must not mutate', () => {
    const s = createState()
    const before = hashState(s)
    checkBuild(s, 0, 4, 11)
    checkBuild(s, 0, 4, 5)
    checkBuild(s, 0, -5, -5)
    expect(hashState(s)).toBe(before)
  })

  it('builds only in your own lane', () => {
    const s = run(3, {
      0: [build(5, 5, TowerKind.Single, 0), build(6, 9, TowerKind.Single, 1)],
    })
    expect(s.lanes[0]!.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(TowerKind.Single)
    expect(s.lanes[0]!.towers.kind[tileIndex({ x: 6, y: 9 })]).toBe(-1)
    expect(s.lanes[1]!.towers.kind[tileIndex({ x: 6, y: 9 })]).toBe(TowerKind.Single)
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
    let s = run(200, { 0: [send(TANK)] })
    const walked = s.lanes[0]!.creeps.y[0] as number
    expect(walked).toBeGreaterThan(1.5)

    // Seal the lane by hand above and below the creep, bypassing canBuild.
    // This is the state the teleport exists to recover from.
    const row = Math.floor(walked)
    const col = Math.floor(s.lanes[0]!.creeps.x[0] as number)
    wall(s, row + 1, [])
    wall(s, row - 1, [])
    buildField(s.lanes[0]!.blocked, s.lanes[0]!.field)
    expect(s.lanes[0]!.field.dist[tileIndex({ x: col, y: row })]).toBe(UNREACHABLE)

    s = tick(s)
    expect(s.lanes[0]!.creeps.y[0] as number).toBeLessThan(1)
  })
})
