/**
 * Grid constants and tile arithmetic for one lane.
 *
 * The sim speaks only in tile coordinates. World units, pixels and camera space
 * belong to the renderer and must never appear here.
 *
 *        x=0                                     x=39
 *   y=0  +--------------------------------------+
 *        |                                      |
 *  y=11  |IN                                 OUT|   spawn/exit occupy
 *  y=12  |IN                                 OUT|   two tiles each
 *        |                                      |
 *  y=23  +--------------------------------------+
 *
 * Row-major indexing throughout: index = y * GRID_W + x. Every ordered
 * iteration in the sim breaks ties on this index, so it is load-bearing for
 * determinism, not just convenience.
 */

export const GRID_W = 40
export const GRID_H = 24
export const TILE_COUNT = GRID_W * GRID_H

export interface Tile {
  readonly x: number
  readonly y: number
}

/** Spawn and exit each occupy two tiles, per the design doc. */
export const SPAWN_TILES: readonly Tile[] = [
  { x: 0, y: 11 },
  { x: 0, y: 12 },
]
export const EXIT_TILES: readonly Tile[] = [
  { x: GRID_W - 1, y: 11 },
  { x: GRID_W - 1, y: 12 },
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
