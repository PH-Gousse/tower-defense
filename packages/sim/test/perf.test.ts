import { describe, it, expect } from 'vitest'
import { performance } from 'node:perf_hooks'
import { createState, type GameState } from '../src/state'
import { step, checkBuild, Kind, TICK_MS, type Command } from '../src/step'
import { templateAt } from '../src/maze'
import { TowerKind } from '../src/data'
import { GRID_W, TOWER_SIZE } from '../src/grid'
import { place, R, SWARM, RUNNER, TANK, withoutBuildPhase } from './helpers'

withoutBuildPhase()

/**
 * The tick budget at the new scale.
 *
 * ADR-0019 puts up to 800 towers and hundreds of creeps in a lane, and the
 * spatial hash exists so that targeting does not go quadratic there. This
 * builds the board the brief names -- a full maze of 400 towers and 500
 * creeps -- and measures a tick against the 50 ms budget with room to spare
 * for the renderer, which shares the frame.
 *
 * Generous on purpose: CI machines are slow and noisy, and a flaky budget test
 * teaches people to ignore it. The line is a quarter of the tick, averaged
 * over two hundred ticks; a regression that mattered would be several times
 * that, not a few percent.
 */
describe('tick budget', () => {
  function fullMaze(): GameState {
    const s = createState()
    const tiles = templateAt(1).tiles
    let placed = 0
    for (let i = 0; i < tiles.length && placed < 400; i++) {
      const t = tiles[i]!
      const kind = i % 5 === 3 ? TowerKind.Splash : i % 5 === 4 ? TowerKind.Slow : TowerKind.Single
      place(s, 0, t.x, t.y, kind, 1 + (i % 3))
      placed += 1
    }
    expect(s.lanes[0]!.towers.count).toBe(400)
    return s
  }

  it('stays well inside the tick with 400 towers and 500 creeps', () => {
    let s = fullMaze()
    ;(s.players[1] as { gold: number }).gold = 1e9
    ;(s.players[0] as { lives: number }).lives = 1e6
    const wave: Command[] = []
    for (let i = 0; i < 500; i++) {
      wave.push({ tick: 0, player: 1, kind: Kind.Send, creep: [SWARM, RUNNER, TANK][i % 3] as number })
    }
    let into = createState()
    let out = step(s, wave, into)
    into = s
    s = out
    // A few die on the spawn tick: towers on the first buildable row reach
    // into the spawn zone, and a swarm does not survive one shot.
    expect(s.lanes[0]!.creeps.count).toBeGreaterThan(450)

    // Let the crowd spread into the maze before timing, so the hash has real
    // work to do rather than a spawn zone full of creeps.
    for (let t = 0; t < 300; t++) {
      out = step(s, [], into)
      into = s
      s = out
    }
    expect(s.lanes[0]!.creeps.count).toBeGreaterThan(100)

    const ticks = 200
    const start = performance.now()
    for (let t = 0; t < ticks; t++) {
      out = step(s, [], into)
      into = s
      s = out
    }
    const perTick = (performance.now() - start) / ticks
    expect(perTick, `ms per tick`).toBeLessThan(TICK_MS / 4)
  })

  it('answers a placement check on a full maze fast enough to hover with', () => {
    // The hover preview rebuilds the flow field on every tile change. A
    // player drags across a dozen tiles a second; each has to be cheap.
    const s = fullMaze()
    const anchors: [number, number][] = []
    for (let ax = 0; ax + TOWER_SIZE <= GRID_W; ax++) for (let ay = R; ay < R + 40; ay++) anchors.push([ax, ay])
    const start = performance.now()
    for (const [ax, ay] of anchors) checkBuild(s, 0, ax, ay)
    const per = (performance.now() - start) / anchors.length
    expect(per, 'ms per checkBuild').toBeLessThan(2)
  })
})
