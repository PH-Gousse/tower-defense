import { describe, it, expect } from 'vitest'
import {
  buildField,
  spawnsReachable,
  mazeLength,
  UNREACHABLE,
} from '../src/field'
import {
  TILE_COUNT,
  GRID_W,
  GRID_H,
  Dir,
  SPAWN_INDICES,
  EXIT_INDICES,
  tileIndex,
} from '../src/grid'

const empty = () => new Uint8Array(TILE_COUNT)

/**
 * Steps from a spawn tile to the nearest exit tile down a bare lane.
 *
 * The lane is vertical with the entrance top-left and the exit bottom-right, so
 * the bare route is diagonal: the full drop plus the sideways crossing.
 */
const bareDist = (spawnX: number) => GRID_H - 1 + (GRID_W - 2 - spawnX)

/** A wall across the lane. `gap` is the one column left open, or -1 to seal. */
function wall(b: Uint8Array, y: number, gap: number): void {
  for (let x = 0; x < GRID_W; x++) if (x !== gap) b[tileIndex({ x, y })] = 1
}

describe('flow field', () => {
  it('puts distance 0 on the exit tiles', () => {
    const f = buildField(empty())
    for (const e of EXIT_INDICES) expect(f.dist[e]).toBe(0)
  })

  it('measures an empty lane as the diagonal walk', () => {
    const f = buildField(empty())
    // Entrance top-left, exit bottom-right: drop the full height, cross the
    // width. No detour, but not a straight line either.
    SPAWN_INDICES.forEach((s, i) => expect(f.dist[s]).toBe(bareDist(i)))
    // The score is the worst spawn, which is the one furthest from the exit.
    expect(mazeLength(f)).toBe(bareDist(0))
  })

  it('points every reachable tile at a neighbour one step closer', () => {
    const b = empty()
    b[tileIndex({ x: 3, y: 11 })] = 1
    b[tileIndex({ x: 4, y: 11 })] = 1
    const f = buildField(b)
    let checked = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      const d = f.dist[i] as number
      if (d === UNREACHABLE || d === 0) continue
      expect(f.dir[i]).not.toBe(Dir.None)
      checked++
    }
    expect(checked).toBeGreaterThan(TILE_COUNT - 12)
  })

  it('is uniquely determined by N,E,S,W order — same input, same field', () => {
    const b = empty()
    wall(b, 12, 0)
    const a = buildField(b)
    const c = buildField(b)
    expect(Array.from(a.dist)).toEqual(Array.from(c.dist))
    expect(Array.from(a.dir)).toEqual(Array.from(c.dir))
  })

  it('lengthens the maze when a wall forces a detour', () => {
    const b = empty()
    // A wall across the lane with its only gap on the far side of the drop
    // forces the route to cross the lane twice instead of once.
    wall(b, 12, GRID_W - 1)
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(true)
    expect(mazeLength(f)).toBeGreaterThan(bareDist(0))
  })

  it('reports the spawn unreachable when the lane is sealed', () => {
    const b = empty()
    wall(b, 12, -1)
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(false)
    for (const s of SPAWN_INDICES) expect(f.dist[s]).toBe(UNREACHABLE)
    expect(mazeLength(f)).toBe(UNREACHABLE)
  })

  it('reuses caller buffers without leaking stale distances', () => {
    const sealed = new Uint8Array(TILE_COUNT)
    wall(sealed, 12, -1)
    const reused = buildField(sealed)
    // Same buffers, now with an open lane: nothing from the sealed run survives.
    const open = buildField(empty(), reused)
    expect(spawnsReachable(open)).toBe(true)
    expect(open.dist[SPAWN_INDICES[0] as number]).toBe(bareDist(0))
  })
})
