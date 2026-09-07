import { describe, it, expect } from 'vitest'
import { createState, MatchResult, STARTING_LIVES, type GameState } from '../src/state'
import { step, Kind, DEFAULT_CONFIG, type Command } from '../src/step'
import { TowerKind } from '../src/data'
import { hashState } from '../src/hash'
import { GRID_H, tileIndex } from '../src/grid'

/** Run until a predicate holds, or give up. Returns the final state. */
function runUntil(
  predicate: (s: GameState) => boolean,
  maxTicks: number,
  config = DEFAULT_CONFIG,
  cmdsAt: Record<number, Command[]> = {},
): GameState {
  let a = createState()
  let b = createState()
  for (let t = 0; t < maxTicks; t++) {
    const out = step(a, cmdsAt[t] ?? [], b, config)
    b = a
    a = out
    if (predicate(a)) return a
  }
  return a
}

// Fast creep, no towers: it walks the empty lane and leaks repeatedly.
const LEAKY = { ...DEFAULT_CONFIG, spawnTotal: 1, creepSpeed: 1.0, creepHp: 100000 }

describe('the loop', () => {
  it('costs the defender a life per leak', () => {
    const s = runUntil((x) => x.leaks >= 3, 2000, LEAKY)
    expect(s.leaks).toBe(3)
    expect(s.lives).toBe(STARTING_LIVES - 3)
  })

  it('credits the sender nothing — lives only ever go down', () => {
    // The damping rule. Crediting a sender would make each leak a 2-point
    // swing and let a leader compound in lives and income at once.
    const s = runUntil((x) => x.leaks >= 5, 2000, LEAKY)
    expect(s.lives).toBeLessThan(STARTING_LIVES)
    expect(s.lives + s.leaks).toBe(STARTING_LIVES)
  })

  it('loops the creep instead of despawning it, keeping damage and lap count', () => {
    const s = runUntil((x) => x.leaks >= 2, 2000, LEAKY)
    expect(s.lane.creeps.count).toBe(1)
    expect(s.lane.creeps.laps[0] as number).toBe(2)
    // Back near the spawn, not removed and not left at the exit.
    expect(s.lane.creeps.x[0] as number).toBeLessThan(2)
  })

  it('never caps laps or decays a creep — only damage removes one', () => {
    const s = runUntil((x) => x.leaks >= 8, 4000, LEAKY)
    expect(s.lane.creeps.count).toBe(1)
    expect(s.lane.creeps.laps[0] as number).toBeGreaterThanOrEqual(8)
    expect(s.lane.creeps.hp[0] as number).toBe(100000)
  })

  it('ends the match at zero lives', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, 20000, LEAKY)
    expect(s.result).toBe(MatchResult.Defeat)
    expect(s.lives).toBe(0)
    expect(s.leaks).toBe(STARTING_LIVES)
  })

  it('never reports negative lives, even on the losing leak', () => {
    const s = runUntil((x) => x.result !== MatchResult.Playing, 20000, LEAKY)
    expect(s.lives).toBe(0)
  })

  it('freezes once the match is over — no tick, no commands, no movement', () => {
    const over = runUntil((x) => x.result !== MatchResult.Playing, 20000, LEAKY)
    const before = hashState(over)
    const tickBefore = over.tick

    const b = createState()
    const after = step(over, [
      { tick: 0, player: 0, kind: Kind.Build, tower: TowerKind.Single, x: 5, y: 5 },
    ], b, LEAKY)

    expect(after.tick).toBe(tickBefore)
    expect(hashState(after)).toBe(before)
    // The build was ignored, not applied.
    expect(after.lane.towers.kind[tileIndex({ x: 5, y: 5 })]).toBe(-1)
  })

  it('a creep the maze cannot kill drains the match on its own', () => {
    // The design's core pressure, asserted: one unkillable creep is enough to
    // lose, because nothing but damage removes it and every lap costs a life.
    const cmds: Command[] = []
    for (let y = 0; y < GRID_H; y++) {
      if (y === 11 || y === 12) continue
      cmds.push({ tick: 0, player: 0, kind: Kind.Build, tower: TowerKind.Single, x: 20, y })
    }
    const s = runUntil((x) => x.result !== MatchResult.Playing, 30000, LEAKY, { 0: cmds })
    expect(s.result).toBe(MatchResult.Defeat)
    expect(s.kills).toBe(0)
  })
})
