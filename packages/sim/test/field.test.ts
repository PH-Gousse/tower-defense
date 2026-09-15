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
  TOWER_SIZE,
  TOWERS_ACROSS,
  SPARE_TILES,
  BUILD_ROW_MIN,
  EXIT_ROW_MIN,
  Dir,
  SPAWN_INDICES,
  EXIT_INDICES,
  FOOTPRINT_CELLS,
  footprintCells,
  tileIndex,
  tileY,
} from '../src/grid'

const empty = () => new Uint8Array(TILE_COUNT)
const cells = new Int32Array(FOOTPRINT_CELLS)

/** Mark a 2x2 footprint blocked. */
function tower(b: Uint8Array, ax: number, ay: number): void {
  footprintCells(ax, ay, cells)
  for (let k = 0; k < FOOTPRINT_CELLS; k++) b[cells[k] as number] = 1
}

/**
 * A wall of towers across the lane at rows y..y+1. Columns listed in `open`
 * are left clear; an anchor whose footprint touches one is skipped.
 */
function wall(b: Uint8Array, y: number, open: readonly number[]): void {
  for (let ax = 0; ax + TOWER_SIZE <= GRID_W; ax += TOWER_SIZE) {
    if (open.includes(ax) || open.includes(ax + 1)) continue
    tower(b, ax, y)
  }
}

/**
 * Seal the lane at rows y..y+1. A full row leaves the spare column open
 * (ADR-0027), so the seal is the row plus a plug directly below it at that
 * column; on a lane with no spare column the row alone seals.
 */
function seal(b: Uint8Array, y: number): void {
  wall(b, y, [])
  if (SPARE_TILES > 0) tower(b, GRID_W - TOWER_SIZE, y + TOWER_SIZE)
}

/** Steps from a spawn cell straight down to the exit zone on a bare lane. */
const bareDist = (y: number) => EXIT_ROW_MIN - y

describe('flow field', () => {
  it('puts distance 0 on every exit-zone cell', () => {
    const f = buildField(empty())
    for (const e of EXIT_INDICES) expect(f.dist[e]).toBe(0)
  })

  it('measures an empty lane as a straight drop from each spawn cell', () => {
    const f = buildField(empty())
    for (const s of SPAWN_INDICES) expect(f.dist[s]).toBe(bareDist(tileY(s)))
    // The score is the worst spawn cell: the far row of the zone.
    expect(mazeLength(f)).toBe(bareDist(0))
  })

  it('points every cell of an empty lane south', () => {
    const f = buildField(empty())
    for (let i = 0; i < TILE_COUNT; i++) {
      if (tileY(i) >= EXIT_ROW_MIN) continue
      expect(f.dir[i], `tile ${i}`).toBe(Dir.S)
    }
  })

  it('points every reachable tile at a neighbour one step closer', () => {
    const b = empty()
    tower(b, 6, BUILD_ROW_MIN + 5)
    const f = buildField(b)
    let checked = 0
    for (let i = 0; i < TILE_COUNT; i++) {
      const d = f.dist[i] as number
      if (d === UNREACHABLE || d === 0) continue
      expect(f.dir[i]).not.toBe(Dir.None)
      checked++
    }
    expect(checked).toBe(TILE_COUNT - EXIT_INDICES.length - FOOTPRINT_CELLS)
  })

  it('is uniquely determined by N,E,S,W order — same input, same field', () => {
    const b = empty()
    wall(b, BUILD_ROW_MIN + 4, [0, 1])
    const a = buildField(b)
    const c = buildField(b)
    expect(Array.from(a.dist)).toEqual(Array.from(c.dist))
    expect(Array.from(a.dir)).toEqual(Array.from(c.dir))
  })

  it('lengthens the maze when a wall forces a detour', () => {
    const b = empty()
    wall(b, BUILD_ROW_MIN + 4, [GRID_W - 2, GRID_W - 1])
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(true)
    expect(mazeLength(f)).toBeGreaterThan(bareDist(0))
    // The wall moved every spawn cell by the same detour, so the far-left
    // corner is still the worst case and it walks the width to the gap,
    // which opens where the skipped last tower would have started.
    expect(mazeLength(f)).toBe(bareDist(0) + (TOWERS_ACROSS - 1) * TOWER_SIZE)
  })

  it('passes a 1-wide gap: creeps are one tile, so one tile is a corridor', () => {
    // Towers at anchors 0 and 3 leave column 2 open between them -- the
    // half-slot. The rest of the row is closed by the ordinary stride up to
    // the far edge.
    const b = empty()
    const y = BUILD_ROW_MIN + 4
    tower(b, 0, y)
    for (let ax = 3; ax + TOWER_SIZE <= GRID_W; ax += TOWER_SIZE) tower(b, ax, y)
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(true)
    // The route runs through the slot and nowhere else on that row.
    expect(f.dist[tileIndex({ x: 2, y })]).not.toBe(UNREACHABLE)
    expect(f.dist[tileIndex({ x: 1, y })]).toBe(UNREACHABLE)
    expect(f.dist[tileIndex({ x: 3, y })]).toBe(UNREACHABLE)
    expect(f.dist[tileIndex({ x: GRID_W - 1, y })]).toBe(UNREACHABLE)
  })

  it('does not pass a diagonal: towers touching at a corner seal the gap', () => {
    // A pocket under the right end of a wall whose only way out is between
    // two towers meeting at a corner: the wall stops three tiles short of the
    // edge, a tower two rows down covers the two tiles next to the wall's
    // end, and a tower two rows below that covers the edge tiles. Under
    // 4-neighbour connectivity the corner is a wall. Written this way rather
    // than as a staircase across the lane so it holds whatever the width.
    const b = empty()
    const y = BUILD_ROW_MIN + 2
    wall(b, y, [GRID_W - 3, GRID_W - 2, GRID_W - 1])
    tower(b, GRID_W - 4, y + TOWER_SIZE)
    tower(b, GRID_W - 2, y + 2 * TOWER_SIZE)
    expect(spawnsReachable(buildField(b))).toBe(false)
    // The same last tower one row lower leaves a cell between the corners.
    const c = empty()
    wall(c, y, [GRID_W - 3, GRID_W - 2, GRID_W - 1])
    tower(c, GRID_W - 4, y + TOWER_SIZE)
    tower(c, GRID_W - 2, y + 2 * TOWER_SIZE + 1)
    expect(spawnsReachable(buildField(c))).toBe(true)
  })

  it('reports the spawn zone unreachable when the lane is sealed', () => {
    const b = empty()
    seal(b, BUILD_ROW_MIN + 4)
    const f = buildField(b)
    expect(spawnsReachable(f)).toBe(false)
    for (const s of SPAWN_INDICES) expect(f.dist[s]).toBe(UNREACHABLE)
    expect(mazeLength(f)).toBe(UNREACHABLE)
  })

  it('reuses caller buffers without leaking stale distances', () => {
    const sealed = new Uint8Array(TILE_COUNT)
    wall(sealed, BUILD_ROW_MIN + 4, [])
    const reused = buildField(sealed)
    // Same buffers, now with an open lane: nothing from the sealed run survives.
    const open = buildField(empty(), reused)
    expect(spawnsReachable(open)).toBe(true)
    expect(open.dist[SPAWN_INDICES[0] as number]).toBe(bareDist(0))
  })

  it('covers the whole lane, not a smaller one', () => {
    // A guard against a hard-coded 24 surviving somewhere: the field must
    // reach the bottom of the spawn zone through GRID_H rows of cells.
    const f = buildField(empty())
    expect(f.dist.length).toBe(GRID_W * GRID_H)
    expect(f.dist[0]).toBe(EXIT_ROW_MIN)
  })
})
