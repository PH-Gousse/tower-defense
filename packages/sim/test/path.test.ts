import { describe, it, expect } from 'vitest'
import { buildField, UNREACHABLE } from '../src/field'
import { pathFrom } from '../src/path'
import {
  TILE_COUNT,
  GRID_W,
  TOWER_SIZE,
  SPARE_TILES,
  BUILD_ROW_MIN,
  EXIT_ROW_MIN,
  SPAWN_INDICES,
  EXIT_INDICES,
  FOOTPRINT_CELLS,
  footprintCells,
} from '../src/grid'

const empty = () => new Uint8Array(TILE_COUNT)
const spawn = SPAWN_INDICES[0] as number
const cells = new Int32Array(FOOTPRINT_CELLS)

function tower(b: Uint8Array, ax: number, ay: number): void {
  footprintCells(ax, ay, cells)
  for (let k = 0; k < FOOTPRINT_CELLS; k++) b[cells[k] as number] = 1
}

/** A wall across the lane at rows y..y+1, leaving the listed columns open. */
function wall(b: Uint8Array, y: number, open: readonly number[]): void {
  for (let ax = 0; ax + TOWER_SIZE <= GRID_W; ax += TOWER_SIZE) {
    if (open.includes(ax) || open.includes(ax + 1)) continue
    tower(b, ax, y)
  }
}

/** A full row plus, on a lane with a spare column (ADR-0027), the plug below it. */
function seal(b: Uint8Array, y: number): void {
  wall(b, y, [])
  if (SPARE_TILES > 0) tower(b, GRID_W - TOWER_SIZE, y + TOWER_SIZE)
}

describe('pathFrom', () => {
  it('walks an empty lane straight down to the exit zone', () => {
    const p = pathFrom(buildField(empty()), spawn)
    expect(p[0]).toBe(spawn)
    expect(EXIT_INDICES).toContain(p[p.length - 1])
    // The drop from row 0 to the first exit row, and one more because the
    // route counts tiles rather than steps.
    expect(p.length).toBe(EXIT_ROW_MIN + 1)
  })

  it('returns an empty route when the lane is sealed', () => {
    const b = empty()
    seal(b, BUILD_ROW_MIN + 4)
    const f = buildField(b)
    expect(f.dist[spawn]).toBe(UNREACHABLE)
    expect(pathFrom(f, spawn)).toEqual([])
  })

  it('is exactly as long as the maze score claims', () => {
    const b = empty()
    wall(b, BUILD_ROW_MIN + 4, [GRID_W - 2, GRID_W - 1])
    wall(b, BUILD_ROW_MIN + 8, [0, 1])
    const f = buildField(b)
    const p = pathFrom(f, spawn)
    // dist counts steps; the route counts tiles, so it is one longer.
    expect(p.length).toBe((f.dist[spawn] as number) + 1)
  })

  it('never revisits a tile — dist strictly decreases along the walk', () => {
    const b = empty()
    wall(b, BUILD_ROW_MIN + 4, [GRID_W - 2, GRID_W - 1])
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
    seal(b, BUILD_ROW_MIN + 4)
    const sealed = pathFrom(buildField(b), spawn, out)
    expect(lenLong).toBeGreaterThan(0)
    expect(sealed.length).toBe(0)
  })
})
