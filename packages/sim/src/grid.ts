/**
 * Grid constants and tile arithmetic for one lane.
 *
 * The sim speaks only in tile coordinates. World units, pixels and camera space
 * belong to the renderer and must never appear here.
 *
 * **The tile is the creep tile and the only unit.** A creep occupies 1 × 1, a
 * tower 2 × 2, and no code path may assume the two are the same size (ADR-0019).
 * Every geometric constant lives in this file; nothing else in the repo may
 * hard-code a lane dimension.
 *
 * The lane runs **vertically**: creeps enter at the top and walk down.
 *
 *        x=0                          x=16
 *   y=0  +------------------------------+
 *        |          SPAWN ZONE          |   SPAWN_ROWS rows. Creeps appear
 *        |     (10 rows, not buildable) |   anywhere in here. Never built on.
 *  y=10  +------------------------------+
 *        |                              |
 *        |        BUILDABLE AREA        |   LANE_LENGTH rows. Towers are 2x2
 *        |     (LANE_LENGTH rows)       |   and anchor on any tile whose
 *        |                              |   footprint stays inside this area.
 *        |                              |
 * y=110  +------------------------------+
 *        |          EXIT ZONE           |   EXIT_ROWS rows. A creep whose
 *        |      (3 rows, not buildable) |   position enters here has leaked.
 * y=112  +------------------------------+
 *
 * Why the zones are whole rows rather than a few tiles: a creep entering or
 * leaving is then never adjacent to a wall at the moment it is being placed,
 * and the player gets a rule they can see ("the ends are free") instead of a
 * handful of magic tiles.
 *
 * Length derivation, for the record (ADR-0019): the Reforged map is 160 x 128
 * terrain tiles, one terrain tile holds one tower, so a lane is 8 terrain tiles
 * = 16 creep tiles wide and the map is 256 creep tiles tall; after the border
 * and the two zones, about 200 buildable rows. That is what shipped on
 * 2026-09-13, and two days of play said it was far too long: the lane is
 * half that now. Nothing in the code depends on the exact figure -- but every
 * lap time scales with it, which is what ADR-0025 is about.
 *
 * Row-major indexing throughout: index = y * GRID_W + x. Every ordered
 * iteration in the sim breaks ties on this index, so it is load-bearing for
 * determinism, not just convenience.
 */

/**
 * Tiles across. `[proposed]` 17 -- one more than ADR-0019's 16, see ADR-0027.
 *
 * Odd on purpose: a full row of TOWERS_ACROSS towers covers 16 tiles and
 * leaves SPARE_TILES = 1 open, so a straight wall is a half-slot by itself
 * and the row's only gap is exactly one creep wide.
 */
export const LANE_WIDTH = 17
/** A tower's footprint is TOWER_SIZE x TOWER_SIZE tiles. */
export const TOWER_SIZE = 2
/** A creep's footprint is CREEP_SIZE x CREEP_SIZE tiles. The unit itself. */
export const CREEP_SIZE = 1
/** Rows of the spawn zone, at the top of the lane. */
export const SPAWN_ROWS = 10
/** Rows of the exit zone, at the bottom. */
export const EXIT_ROWS = 3
/**
 * Buildable rows between the two zones. `[proposed]` 100 -- see ADR-0019 for
 * the 200 it started at and ADR-0027 for the cut to half.
 */
export const LANE_LENGTH = 100
/**
 * Tiles between the two lanes when they are drawn side by side. `[proposed]`.
 * The sim never reads it -- lanes do not touch -- but it is a lane dimension,
 * and lane dimensions live here.
 */
export const LANE_GAP = 4

/**
 * Side of a spatial-hash cell, in tiles, for tower targeting. `[proposed]` 4.
 *
 * Not geometry, but it is sized against the geometry: a tower's range query
 * touches (2r / HASH_CELL)^2 cells, so at 4 a range-10 tower visits ~36 cells
 * where per-tile buckets would visit ~440. See towers.ts.
 */
export const HASH_CELL = 4

export const GRID_W = LANE_WIDTH
export const GRID_H = SPAWN_ROWS + LANE_LENGTH + EXIT_ROWS
export const TILE_COUNT = GRID_W * GRID_H

/** Towers that fit side by side in one row. */
export const TOWERS_ACROSS = Math.floor(LANE_WIDTH / TOWER_SIZE)
/** Tiles left over beside a full row of towers: the width a straight wall's gap has. */
export const SPARE_TILES = LANE_WIDTH - TOWERS_ACROSS * TOWER_SIZE

/** First and last row (inclusive) a footprint may occupy. */
export const BUILD_ROW_MIN = SPAWN_ROWS
export const BUILD_ROW_MAX = SPAWN_ROWS + LANE_LENGTH - 1
/** First row of the exit zone. */
export const EXIT_ROW_MIN = SPAWN_ROWS + LANE_LENGTH

/**
 * Most towers a lane can hold: whole footprints across times whole footprints
 * down. Footprints never overlap, so this bounds the dense tower list whatever
 * the anchors are. Per axis rather than area over area, because a spare
 * column holds no tower at all.
 */
export const MAX_TOWERS = TOWERS_ACROSS * Math.floor(LANE_LENGTH / TOWER_SIZE)

export interface Tile {
  readonly x: number
  readonly y: number
}

export enum Zone {
  Spawn = 0,
  Build = 1,
  Exit = 2,
}

export function zoneOfRow(y: number): Zone {
  if (y < SPAWN_ROWS) return Zone.Spawn
  if (y >= EXIT_ROW_MIN) return Zone.Exit
  return Zone.Build
}

/**
 * Every cell of the spawn zone, row-major. The BFS reachability question is
 * asked of these, and `spawnPointFor` places creeps among them.
 */
export const SPAWN_INDICES: readonly number[] = (() => {
  const out: number[] = []
  for (let y = 0; y < SPAWN_ROWS; y++) for (let x = 0; x < GRID_W; x++) out.push(y * GRID_W + x)
  return out
})()

/** Every cell of the exit zone, row-major. The flow field is seeded from these. */
export const EXIT_INDICES: readonly number[] = (() => {
  const out: number[] = []
  for (let y = EXIT_ROW_MIN; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) out.push(y * GRID_W + x)
  return out
})()

/**
 * Transitional exports for the client, which still draws an "entrance row"
 * and an "exit row" from the old 8 x 24 board. Phase 3 of the restructure
 * replaces them with the zones; nothing in the sim reads them.
 */
export const ENTRANCE_ROW = 0
export const EXIT_ROW = GRID_H - 1
export const SPAWN_TILES: readonly Tile[] = SPAWN_INDICES.map((i) => ({ x: tileX(i), y: tileY(i) }))
export const EXIT_TILES: readonly Tile[] = EXIT_INDICES.map((i) => ({ x: tileX(i), y: tileY(i) }))

/**
 * Neighbour order is N, E, S, W and never changes.
 *
 * This is a determinism pin, not a style choice. The flow field picks the first
 * neighbour that improves distance, so a different order produces a different
 * (equally valid) field, and two clients disagreeing on it is a desync.
 *
 *        N (y-1)
 *          |
 *  W ----- + ----- E   (x-1)      (x+1)
 *          |
 *        S (y+1)
 */
export enum Dir {
  None = -1,
  N = 0,
  E = 1,
  S = 2,
  W = 3,
}

export const DIR_DX: readonly number[] = [0, 1, 0, -1]
export const DIR_DY: readonly number[] = [-1, 0, 1, 0]

export function tileIndex(t: Tile): number {
  return t.y * GRID_W + t.x
}

export function tileX(index: number): number {
  return index % GRID_W
}

export function tileY(index: number): number {
  return (index - (index % GRID_W)) / GRID_W
}

export function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H
}

export function isSpawnIndex(index: number): boolean {
  return tileY(index) < SPAWN_ROWS
}

export function isExitIndex(index: number): boolean {
  return tileY(index) >= EXIT_ROW_MIN
}

/** Whether a tile may hold part of a tower: inside the buildable rows. */
export function isBuildIndex(index: number): boolean {
  const y = tileY(index)
  return y >= BUILD_ROW_MIN && y <= BUILD_ROW_MAX
}

// --- footprints --------------------------------------------------------------

/** Cells of a footprint, always TOWER_SIZE squared. */
export const FOOTPRINT_CELLS = TOWER_SIZE * TOWER_SIZE

/**
 * The tile indices a tower anchored at (ax, ay) occupies, row-major into
 * `out`. The anchor is the footprint's top-left (lowest x, lowest y) tile.
 *
 * Callers must have checked `footprintInGrid` first: an anchor on the last
 * column or row would wrap into the next row here, silently.
 */
export function footprintCells(ax: number, ay: number, out: Int32Array): void {
  let n = 0
  for (let dy = 0; dy < TOWER_SIZE; dy++) {
    for (let dx = 0; dx < TOWER_SIZE; dx++) {
      out[n] = (ay + dy) * GRID_W + (ax + dx)
      n += 1
    }
  }
}

/** Whether the whole footprint lies inside the lane. */
export function footprintInGrid(ax: number, ay: number): boolean {
  return ax >= 0 && ay >= 0 && ax + TOWER_SIZE <= GRID_W && ay + TOWER_SIZE <= GRID_H
}

/** Whether the whole footprint lies inside the buildable rows. */
export function footprintInBuildArea(ax: number, ay: number): boolean {
  return footprintInGrid(ax, ay) && ay >= BUILD_ROW_MIN && ay + TOWER_SIZE - 1 <= BUILD_ROW_MAX
}

/** Whether (x, y) lies inside the footprint anchored at (ax, ay). */
export function footprintContains(ax: number, ay: number, x: number, y: number): boolean {
  return x >= ax && x < ax + TOWER_SIZE && y >= ay && y < ay + TOWER_SIZE
}

/** The tower's centre, which is where range is measured from. */
export function footprintCentreX(ax: number): number {
  return ax + TOWER_SIZE / 2
}

export function footprintCentreY(ay: number): number {
  return ay + TOWER_SIZE / 2
}
