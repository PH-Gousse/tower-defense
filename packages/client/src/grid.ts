/**
 * Grid constants and tile arithmetic for one lane.
 *
 * The lane is a 40 x 24 tile field. World space puts tile (0,0) at the origin
 * corner and extends +X to the right, +Z toward the viewer, so a tile's centre
 * is at (x + 0.5, 0, y + 0.5). Keeping that conversion in one place matters:
 * the sim will speak only in tile coordinates, and the renderer is the only
 * thing that should ever know about world units.
 *
 *        x=0                                     x=39
 *   y=0  +--------------------------------------+
 *        |                                      |
 *  y=11  |IN                                 OUT|   spawn/exit occupy
 *  y=12  |IN                                 OUT|   two tiles each
 *        |                                      |
 *  y=23  +--------------------------------------+
 */

export const GRID_W = 40
export const GRID_H = 24

/** Spawn and exit each occupy two tiles, per the design doc. */
export const SPAWN_TILES: readonly Tile[] = [
  { x: 0, y: 11 },
  { x: 0, y: 12 },
]
export const EXIT_TILES: readonly Tile[] = [
  { x: GRID_W - 1, y: 11 },
  { x: GRID_W - 1, y: 12 },
]

export interface Tile {
  readonly x: number
  readonly y: number
}

export function inBounds(t: Tile): boolean {
  return t.x >= 0 && t.x < GRID_W && t.y >= 0 && t.y < GRID_H
}

/** Row-major index, used everywhere a tile needs a stable numeric identity. */
export function tileIndex(t: Tile): number {
  return t.y * GRID_W + t.x
}

export function isSpawn(t: Tile): boolean {
  return SPAWN_TILES.some((s) => s.x === t.x && s.y === t.y)
}

export function isExit(t: Tile): boolean {
  return EXIT_TILES.some((e) => e.x === t.x && e.y === t.y)
}
