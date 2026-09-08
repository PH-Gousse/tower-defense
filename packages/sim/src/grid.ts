/**
 * Grid constants and tile arithmetic for one lane.
 *
 * The sim speaks only in tile coordinates. World units, pixels and camera space
 * belong to the renderer and must never appear here.
 *
 * The lane runs **vertically**: creeps enter at the top and walk down.
 *
 *        x=0                    x=7
 *   y=0  +IN IN-----------------+   entrance row, two tiles, left side
 *        |                      |
 *        |                      |   rows 1..22 are the buildable maze
 *        |                      |
 *  y=23  +---------------OUT OUT+   exit row, two tiles, right side
 *
 * Entrance and exit sit on **opposite sides**, so the bare-lane route is
 * diagonal — 29 tiles rather than the 23 a straight drop would give. Both of
 * those rows are reserved: nothing builds there, which keeps spawning and exit
 * detection free of the "a tower appeared on the spawn tile" class of bug and
 * guarantees a creep never materialises inside a wall.
 *
 * Width is the maze-richness knob and length is the pace knob; change one at a
 * time. At 8 wide a range-3 tower covers three passes of a serpentine at once,
 * which is what makes placement a decision rather than a uniform tiling. At 24
 * long a bare lap is ~15s and a full maze ~50s, a 4x spread.
 *
 * Row-major indexing throughout: index = y * GRID_W + x. Every ordered
 * iteration in the sim breaks ties on this index, so it is load-bearing for
 * determinism, not just convenience.
 */

export const GRID_W = 8
export const GRID_H = 24
export const TILE_COUNT = GRID_W * GRID_H

export interface Tile {
  readonly x: number
  readonly y: number
}

/** The two rows that exist for arriving and leaving, and are never built on. */
export const ENTRANCE_ROW = 0
export const EXIT_ROW = GRID_H - 1

/** Spawn and exit each occupy two tiles, per the design doc. */
export const SPAWN_TILES: readonly Tile[] = [
  { x: 0, y: ENTRANCE_ROW },
  { x: 1, y: ENTRANCE_ROW },
]
export const EXIT_TILES: readonly Tile[] = [
  { x: GRID_W - 2, y: EXIT_ROW },
  { x: GRID_W - 1, y: EXIT_ROW },
]

export const SPAWN_INDICES: readonly number[] = SPAWN_TILES.map(tileIndex)
export const EXIT_INDICES: readonly number[] = EXIT_TILES.map(tileIndex)

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
  return SPAWN_INDICES.includes(index)
}

export function isExitIndex(index: number): boolean {
  return EXIT_INDICES.includes(index)
}

/**
 * Tiles no tower may occupy: the whole entrance row and the whole exit row.
 *
 * Wider than spawn-and-exit-tiles-only on purpose. Reserving the full rows
 * means a creep entering or leaving is never adjacent to a wall it has to path
 * around at the exact moment it is being teleported, and it gives the player a
 * rule they can see ("the two end rows are free") instead of two magic tiles.
 */
export function isReservedIndex(index: number): boolean {
  const y = tileY(index)
  return y === ENTRANCE_ROW || y === EXIT_ROW
}
