import { describe, it, expect } from 'vitest'
import {
  LANE_WIDTH,
  TOWER_SIZE,
  CREEP_SIZE,
  SPAWN_ROWS,
  EXIT_ROWS,
  LANE_LENGTH,
  GRID_W,
  GRID_H,
  TILE_COUNT,
  MAX_TOWERS,
  TOWERS_ACROSS,
  SPARE_TILES,
  BUILD_ROW_MIN,
  BUILD_ROW_MAX,
  EXIT_ROW_MIN,
  SPAWN_INDICES,
  EXIT_INDICES,
  Zone,
  zoneOfRow,
  isSpawnIndex,
  isExitIndex,
  isBuildIndex,
  tileIndex,
  footprintCells,
  footprintInGrid,
  footprintInBuildArea,
  footprintContains,
  footprintCentreX,
  footprintCentreY,
  FOOTPRINT_CELLS,
} from '../src/grid'

/**
 * The geometry, pinned (ADR-0019). These are the numbers every other test
 * derives its coordinates from, so a change here is a rule change and should
 * read as one.
 */
describe('the lane', () => {
  it('is 17 tiles wide, with 2x2 towers and 1x1 creeps', () => {
    expect(LANE_WIDTH).toBe(17)
    expect(TOWER_SIZE).toBe(2)
    expect(CREEP_SIZE).toBe(1)
    expect(GRID_W).toBe(LANE_WIDTH)
    // A full row is eight towers, and the column left over is one creep wide
    // (ADR-0027): a straight wall has a slot of its own.
    expect(TOWERS_ACROSS).toBe(8)
    expect(SPARE_TILES).toBe(CREEP_SIZE)
  })

  it('is spawn zone, then buildable rows, then exit zone', () => {
    expect(SPAWN_ROWS).toBe(10)
    expect(EXIT_ROWS).toBe(3)
    expect(GRID_H).toBe(SPAWN_ROWS + LANE_LENGTH + EXIT_ROWS)
    expect(TILE_COUNT).toBe(GRID_W * GRID_H)
    expect(BUILD_ROW_MIN).toBe(SPAWN_ROWS)
    expect(BUILD_ROW_MAX).toBe(SPAWN_ROWS + LANE_LENGTH - 1)
    expect(EXIT_ROW_MIN).toBe(BUILD_ROW_MAX + 1)
  })

  it('classifies every row into exactly one zone, with no gap at the seams', () => {
    expect(zoneOfRow(0)).toBe(Zone.Spawn)
    expect(zoneOfRow(SPAWN_ROWS - 1)).toBe(Zone.Spawn)
    expect(zoneOfRow(SPAWN_ROWS)).toBe(Zone.Build)
    expect(zoneOfRow(BUILD_ROW_MAX)).toBe(Zone.Build)
    expect(zoneOfRow(EXIT_ROW_MIN)).toBe(Zone.Exit)
    expect(zoneOfRow(GRID_H - 1)).toBe(Zone.Exit)
    for (let y = 0; y < GRID_H; y++) {
      const i = tileIndex({ x: 3, y })
      const flags = [isSpawnIndex(i), isBuildIndex(i), isExitIndex(i)].filter(Boolean).length
      expect(flags, `row ${y}`).toBe(1)
    }
  })

  it('lists every spawn and exit cell, row-major', () => {
    expect(SPAWN_INDICES.length).toBe(SPAWN_ROWS * GRID_W)
    expect(EXIT_INDICES.length).toBe(EXIT_ROWS * GRID_W)
    expect(SPAWN_INDICES[0]).toBe(0)
    expect(SPAWN_INDICES[SPAWN_INDICES.length - 1]).toBe(tileIndex({ x: GRID_W - 1, y: SPAWN_ROWS - 1 }))
    expect(EXIT_INDICES[0]).toBe(tileIndex({ x: 0, y: EXIT_ROW_MIN }))
    for (let k = 1; k < SPAWN_INDICES.length; k++) {
      expect(SPAWN_INDICES[k]).toBeGreaterThan(SPAWN_INDICES[k - 1] as number)
    }
  })

  it('bounds the tower list by whole footprints across and down', () => {
    // Per axis, not area over area: the spare column holds no tower.
    expect(MAX_TOWERS).toBe(TOWERS_ACROSS * Math.floor(LANE_LENGTH / TOWER_SIZE))
    expect(MAX_TOWERS).toBe(400)
  })
})

describe('footprints', () => {
  const cells = new Int32Array(FOOTPRINT_CELLS)

  it('derive from the anchor, row-major, top-left first', () => {
    footprintCells(3, 20, cells)
    expect(Array.from(cells)).toEqual([
      tileIndex({ x: 3, y: 20 }),
      tileIndex({ x: 4, y: 20 }),
      tileIndex({ x: 3, y: 21 }),
      tileIndex({ x: 4, y: 21 }),
    ])
  })

  it('fit the grid only when the whole footprint does', () => {
    // Every anchor along every edge: the last legal column is GRID_W - 2, the
    // last legal row GRID_H - 2, because the footprint extends one further.
    for (let y = 0; y < GRID_H; y++) {
      expect(footprintInGrid(0, y), `x=0 y=${y}`).toBe(y + TOWER_SIZE <= GRID_H)
      expect(footprintInGrid(GRID_W - TOWER_SIZE, y)).toBe(y + TOWER_SIZE <= GRID_H)
      expect(footprintInGrid(GRID_W - 1, y)).toBe(false)
      expect(footprintInGrid(-1, y)).toBe(false)
    }
    for (let x = 0; x < GRID_W; x++) {
      expect(footprintInGrid(x, GRID_H - 1)).toBe(false)
      expect(footprintInGrid(x, -1)).toBe(false)
    }
  })

  it('fit the build area only when no cell touches a zone', () => {
    for (let x = 0; x <= GRID_W - TOWER_SIZE; x++) {
      expect(footprintInBuildArea(x, BUILD_ROW_MIN), `x=${x} first row`).toBe(true)
      expect(footprintInBuildArea(x, BUILD_ROW_MIN - 1), `x=${x} straddles spawn`).toBe(false)
      expect(footprintInBuildArea(x, BUILD_ROW_MAX - TOWER_SIZE + 1), `x=${x} last row`).toBe(true)
      expect(footprintInBuildArea(x, BUILD_ROW_MAX), `x=${x} straddles exit`).toBe(false)
    }
    expect(footprintInBuildArea(GRID_W - 1, BUILD_ROW_MIN)).toBe(false)
  })

  it('contain exactly their four cells', () => {
    let inside = 0
    for (let y = 18; y < 24; y++) {
      for (let x = 2; x < 8; x++) if (footprintContains(4, 20, x, y)) inside += 1
    }
    expect(inside).toBe(FOOTPRINT_CELLS)
    expect(footprintContains(4, 20, 4, 20)).toBe(true)
    expect(footprintContains(4, 20, 5, 21)).toBe(true)
    expect(footprintContains(4, 20, 6, 21)).toBe(false)
    expect(footprintContains(4, 20, 3, 20)).toBe(false)
  })

  it('measure range from the centre of the footprint, not the anchor', () => {
    expect(footprintCentreX(4)).toBe(5)
    expect(footprintCentreY(20)).toBe(21)
  })
})
