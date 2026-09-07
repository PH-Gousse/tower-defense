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

describe('flow field', () => {
  it('puts distance 0 on the exit tiles', () => {
    const f = buildField(empty())
    for (const e of EXIT_INDICES) expect(f.dist[e]).toBe(0)
  })

  it('measures an empty lane as the straight-line walk', () => {
    const f = buildField(empty())
    // Spawn at x=0, exit at x=39, same rows: 39 steps, no detour.
    for (const s of SPAWN_INDICES) expect(f.dist[s]).toBe(GRID_W - 1)
    expect(mazeLength(f)).toBe(GRID_W - 1)
  })

  it('points every reachable tile at a neighbour one step closer', () => {
    const b = empty()
    b[tileIndex({ x: 10, y: 11 })] = 1
    b[tileIndex({ x: 10, y: 12 })] = 1
    const f = buildField(b)
    let checked = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      const d = f.dist[i] as number
      if (d === UNREACHABLE || d === 0) continue
      expect(f.dir[i]).not.toBe(Dir.None)
      checked++
    }
    expect(checked).toBeGreaterThan(900)
  })

  it('is uniquely determined by N,E,S,W order — same input, same field', () => {
    const b = empty()
    for (let y = 4; y < 20; y++) b[tileIndex({ x: 15, y })] = 1
    const a = buildField(b)
    const c = buildField(b)
    expect(Array.from(a.dist)).toEqual(Array.from(c.dist))
    expect(Array.from(a.dir)).toEqual(Array.from(c.dir))
  })

  it('lengthens the maze when a wall forces a detour', () => {
    const b = empty()
    // A wall across the middle with a gap at the very top forces a long detour.
    for (let y = 2; y < GRID_H; y++) b[tileIndex({ x: 20, y })] = 1
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(true)
    expect(mazeLength(f)).toBeGreaterThan(GRID_W - 1)
  })

  it('reports the spawn unreachable when the lane is sealed', () => {
    const b = empty()
    for (let y = 0; y < GRID_H; y++) b[tileIndex({ x: 20, y })] = 1
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(false)
    for (const s of SPAWN_INDICES) expect(f.dist[s]).toBe(UNREACHABLE)
    expect(mazeLength(f)).toBe(UNREACHABLE)
  })

  it('reuses caller buffers without leaking stale distances', () => {
    const sealed = new Uint8Array(TILE_COUNT)
    for (let y = 0; y < GRID_H; y++) sealed[tileIndex({ x: 20, y })] = 1
    const reused = buildField(sealed)
    // Same buffers, now with an open lane: nothing from the sealed run survives.
    const open = buildField(empty(), reused)
    expect(spawnsReachable(open)).toBe(true)
    expect(open.dist[SPAWN_INDICES[0] as number]).toBe(GRID_W - 1)
  })
})
