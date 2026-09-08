import { describe, it, expect } from 'vitest'
import { buildField, UNREACHABLE } from '../src/field'
import { pathFrom } from '../src/path'
import {
  TILE_COUNT,
  GRID_W,
  GRID_H,
  SPAWN_INDICES,
  EXIT_INDICES,
  tileIndex,
} from '../src/grid'

const empty = () => new Uint8Array(TILE_COUNT)
const spawn = SPAWN_INDICES[0] as number

/** A wall across the vertical lane. `gap` is the column left open, -1 to seal. */
function wall(b: Uint8Array, y: number, gap: number): void {
  for (let x = 0; x < GRID_W; x++) if (x !== gap) b[tileIndex({ x, y })] = 1
}

describe('pathFrom', () => {
  it('walks an empty lane down to the exit', () => {
    const p = pathFrom(buildField(empty()), spawn)
    expect(p[0]).toBe(spawn)
    expect(EXIT_INDICES).toContain(p[p.length - 1])
    // Entrance (0,0) to exit (GRID_W-2, GRID_H-1): the drop plus the crossing,
    // and one more because the route counts tiles rather than steps.
    expect(p.length).toBe(GRID_H - 1 + (GRID_W - 2) + 1)
  })

  it('returns an empty route when the lane is sealed', () => {
    const b = empty()
    wall(b, 12, -1)
    const f = buildField(b)
    expect(f.dist[spawn]).toBe(UNREACHABLE)
    expect(pathFrom(f, spawn)).toEqual([])
  })

  it('is exactly as long as the maze score claims', () => {
    const b = empty()
    wall(b, 8, GRID_W - 1)
    wall(b, 16, 0)
    const f = buildField(b)
    const p = pathFrom(f, spawn)
    // dist counts steps; the route counts tiles, so it is one longer.
    expect(p.length).toBe((f.dist[spawn] as number) + 1)
  })

  it('never revisits a tile — dist strictly decreases along the walk', () => {
    const b = empty()
    wall(b, 12, GRID_W - 1)
    const f = buildField(b)
    const p = pathFrom(f, spawn)
    expect(new Set(p).size).toBe(p.length)
    for (let i = 1; i < p.length; i++) {
      expect(f.dist[p[i] as number] as number).toBe((f.dist[p[i - 1] as number] as number) - 1)
    }
  })

  it('reuses the caller array without leaking the previous route', () => {
    const out: number[] = []
    const long = pathFrom(buildField(empty()), spawn, out)
    const lenLong = long.length
    const b = empty()
    wall(b, 12, -1)
    const sealed = pathFrom(buildField(b), spawn, out)
    expect(lenLong).toBeGreaterThan(0)
    expect(sealed.length).toBe(0)
  })
})
