import {
  GRID_W,
  TOWER_SIZE,
  BUILD_ROW_MIN,
  BUILD_ROW_MAX,
  type Tile,
} from './grid'

/**
 * Maze templates: an ordered wish-list of tower ANCHORS.
 *
 * The bot walks its template and builds the first anchor that is currently
 * legal. Order is the whole design — the early entries have to produce a
 * usable maze on their own, because the bot will often only afford the first
 * handful.
 *
 * Towers are 2x2 (ADR-0019), so a wall is TWO rows of tiles and an anchor
 * steps across the lane by TOWER_SIZE. A serpentine alternates which end the
 * gap is at:
 *
 *        x=0                          x=15
 *   y=10  SPAWN ZONE above; creeps arrive spread across the whole width
 *        ████████████████████████████  ..     7 towers, gap at the RIGHT
 *        ████████████████████████████  ..
 *         .                             ↓     one open row: the corridor
 *         ..  ████████████████████████████    gap at the LEFT
 *         ..  ████████████████████████████
 *         ↓
 *
 * A wall of 7 towers covers 14 of the 16 tiles and leaves a 2-wide gap. It
 * cannot leave a 1-wide gap on its own -- 15 is odd -- and it does not try:
 * these templates are the MINIMUM that keeps the bot functional on the new
 * board, so the harness and determinism-check have an opponent. Designing
 * half-slot mazes for it (offset towers that narrow a 2-wide gap to one creep,
 * ADR-0020) and measuring them is issue #41, a precondition for `/balance`
 * (ADR-0025). Nothing here has been measured against the old templates'
 * figures, and the comments that carried those figures are gone with them.
 *
 * Templates are generated rather than stored as data because the shape is a
 * rule, not a set of numbers, and a rule stays correct if the grid is resized.
 *
 * Every generator stays inside the buildable rows. An anchor in a zone would
 * be refused on every attempt, which the bot reads as "keep trying" rather
 * than "skip".
 */

/** Anchors across a full row of towers. */
const TOWERS_ACROSS = GRID_W / TOWER_SIZE

/**
 * Build a serpentine template.
 *
 * `gapAtRight` alternates per wall so the route has to cross the lane and cross
 * back. Anchors within a wall are emitted from the CLOSED end toward the gap —
 * that is, starting from the side the previous wall's gap dumped the creeps
 * onto. A half-built wall then still blocks the tiles the route is actually
 * using; emitting from the gap end instead would leave the current route wide
 * open until the very last tower, so the bot would pay for most of a wall and
 * get nothing for it.
 *
 * `spacing` is rows from one wall's anchor row to the next; TOWER_SIZE + 1 is
 * the tightest that leaves a corridor.
 */
function serpentine(startY: number, spacing: number, walls: number): Tile[] {
  const out: Tile[] = []
  for (let w = 0; w < walls; w++) {
    const y = startY + w * spacing
    if (y + TOWER_SIZE - 1 > BUILD_ROW_MAX) break
    const gapAtRight = w % 2 === 0
    // One tower short of the full row, leaving TOWER_SIZE tiles open at the gap end.
    if (gapAtRight) {
      for (let a = 0; a < TOWERS_ACROSS - 1; a++) out.push({ x: a * TOWER_SIZE, y })
    } else {
      for (let a = TOWERS_ACROSS - 1; a >= 1; a--) out.push({ x: a * TOWER_SIZE, y })
    }
  }
  return out
}

/**
 * Posts: short walls that cross the middle of the lane, alternating anchor.
 *
 * A tooth has to cross the CENTRE or it does nothing at all: a tooth from the
 * left that stops short of the middle leaves a clear channel from spawn to
 * exit and makes the maze exactly as long as an empty lane. `reach` is in
 * towers back from the centre line, so TOWERS_ACROSS / 2 starts at the edge.
 *
 *   ████████░░░░    from the left, past centre, right side open
 *   ░░░░████████    from the right, past centre, left side open
 *
 * Cheaper per tower than a full serpentine wall and it never risks sealing,
 * which suits a bot that spends most of its gold on sending.
 */
function posts(startY: number, spacing: number, count: number, reach: number): Tile[] {
  const out: Tile[] = []
  const mid = TOWERS_ACROSS / 2
  for (let p = 0; p < count; p++) {
    const y = startY + p * spacing
    if (y + TOWER_SIZE - 1 > BUILD_ROW_MAX) break
    const fromLeft = p % 2 === 0
    const from = fromLeft ? Math.max(0, mid - reach) : mid - 1
    const to = fromLeft ? mid : Math.min(TOWERS_ACROSS - 1, mid - 1 + reach)
    for (let a = from; a <= to; a++) out.push({ x: a * TOWER_SIZE, y })
  }
  return out
}

export interface MazeTemplate {
  readonly name: string
  readonly tiles: readonly Tile[]
}

/**
 * Spacings are in rows. A wall is TOWER_SIZE rows tall, so TOWER_SIZE + 1 is
 * a wall every third row with a one-row corridor, and TOWER_SIZE + 2 leaves a
 * two-row corridor. Wall counts are ceilings; the generators stop at the exit
 * zone.
 */
export const MAZE_TEMPLATES: readonly MazeTemplate[] = [
  { name: 'serpentine', tiles: serpentine(BUILD_ROW_MIN + 1, TOWER_SIZE + 2, 64) },
  { name: 'tight serpentine', tiles: serpentine(BUILD_ROW_MIN, TOWER_SIZE + 1, 80) },
  { name: 'posts', tiles: posts(BUILD_ROW_MIN + 1, TOWER_SIZE + 1, 80, TOWERS_ACROSS / 2) },
]

export function templateAt(index: number): MazeTemplate {
  return MAZE_TEMPLATES[index % MAZE_TEMPLATES.length] as MazeTemplate
}
