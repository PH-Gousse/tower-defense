/**
 * How much bigger than their built size units are drawn.
 *
 * The user asked twice on 2026-09-18 for bigger units, and chose to grow the
 * models rather than zoom the camera in: the board keeps its scale, the things
 * standing on it get larger. Neither model can grow at its source -- asset-gate
 * holds a creep to 0.88 tiles across the walk so it passes a one-tile
 * corridor, and a tower to its 2 x 2 footprint -- so these are render-side
 * multipliers, applied to the built assets and the procedural fallback alike.
 * The simulation sees none of it: hit testing, spacing and placement are all
 * still in tiles.
 */

/** Creeps: 1.8 on the first ask, 2.6 on the second ("still too small"). */
export const CREEP_VIEW_SCALE = 2.6

/**
 * Towers: a built tower is 0.84 of its footprint, 1.68 tiles across. At 1.2 it
 * reaches 2.0, the whole footprint and no further, so a wall of towers reads
 * as a wall rather than welding into one block. Past about 1.2 neighbours
 * overlap.
 */
export const TOWER_VIEW_SCALE = 1.2
