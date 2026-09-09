import { describe, it, expect } from 'vitest'
import { createState, spawnPointFor, SPAWN_PERIOD, type GameState } from '../src/state'
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

describe('sends and where creeps enter', () => {
  it('puts creeps in the opponent lane, never the sender own lane', () => {
    // A creep is owned by its sender for scoring but exists only in the
    // defender's lane. Player 1 sends, so lane 0 fills and lane 1 stays empty.
    const s = run(30, { 0: [send(RUNNER, 1)] })
    expect(s.lanes[0]!.creeps.count).toBe(1)
    expect(s.lanes[1]!.creeps.count).toBe(0)
    expect(s.lanes[0]!.creeps.owner[0]).toBe(1)
  })

  it('puts the whole wave on the board at once, with no pacing', () => {
    // This used to assert the opposite. A release queue paced arrivals at one
    // creep every four ticks, which capped a lane at five a second however fast
    // you clicked -- and clicking fast is how you mass-send. Gold is the only
    // limit now, so six purchases on one tick are six creeps on that tick.
    const wave = Array.from({ length: 6 }, () => send(SWARM))
    expect(run(1, { 0: wave }).lanes[0]!.creeps.count).toBe(6)
  })

  it('starts simultaneous creeps at distinct points, and keeps them apart', () => {
    // The property the queue used to provide, and the reason it could go.
    // Creeps steer centre-to-centre, so a sideways offset is erased by the first
    // tile transition; the offset runs ALONG the route instead, which turns a
    // distance gap into a time gap that centre-snapping cannot undo.
    // The offset follows field.dir at the spawn tile, so an empty lane -- whose
    // route leaves the entrance heading EAST -- sets creeps back in x, not y.
    // Reading the field rather than assuming "back is -y" is the whole point:
    // a y-offset here is lateral, and two creeps equally far either side of the
    // centre reach it on the same tick and weld together.
    const field = createState().lanes[0]!.field
    const a = spawnPointFor(0, field)
    const b = spawnPointFor(1, field)
    const c2 = spawnPointFor(2, field)
    expect(a).not.toEqual(b)
    // Same tile as release 0, but further back along the route.
    expect(c2.y).toBe(a.y)
    expect(c2.x).toBeLessThan(a.x)
    // Tile and slot are coprime, so the pattern repeats only every SPAWN_PERIOD.
    expect(spawnPointFor(SPAWN_PERIOD, field)).toEqual(a)

    // What that buys: six creeps bought on one tick are six distinct points,
    // not one point that a single splash shot clears...
    const wave = Array.from({ length: 6 }, () => send(SWARM))
    const spawned = run(1, { 0: wave }).lanes[0]!.creeps
    const atSpawn = new Set<string>()
    for (let i = 0; i < 6; i++) atSpawn.add(`${spawned.x[i]},${spawned.y[i]}`)
    expect(atSpawn.size).toBe(6)

    // ...and they are still six distinct points a long way down the lane, which
    // is the half that a sideways offset would have failed.
    const c = run(40, { 0: wave }).lanes[0]!.creeps
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
