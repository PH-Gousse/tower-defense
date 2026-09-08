import { GRID_W, ENTRANCE_ROW, EXIT_ROW, type Tile } from './grid'

/**
 * Maze templates: an ordered wish-list of tiles.
 *
 * The bot walks its template and builds the first tile that is currently legal.
 * Order is the whole design — the early entries have to produce a usable maze
 * on their own, because the bot will often only afford the first handful.
 *
 * The lane is vertical, so a wall is a ROW with one end left open, and a
 * serpentine alternates which end:
 *
 *        x=0            x=7
 *   y=0   IN IN            .     creeps drop in top-left
 *        ███████████████   .     gap at the RIGHT
 *         .            ↓
 *         .  ████████████████    gap at the LEFT
 *         ↓            .
 *        ███████████████   .     gap at the RIGHT again
 *   y=23         .     OUT OUT
 *
 * Templates are generated rather than stored as data because the shape is a
 * rule, not a set of numbers, and a rule stays correct if the grid is resized.
 *
 * Every generator stays inside rows ENTRANCE_ROW+1 .. EXIT_ROW-1. The end rows
 * are reserved and a template tile there would be refused on every attempt,
 * which the bot reads as "keep trying" rather than "skip".
 */

/** First and last row a tower may occupy. */
const FIRST_ROW = ENTRANCE_ROW + 1
const LAST_ROW = EXIT_ROW - 1

/**
 * Build a serpentine template.
 *
 * `gapAtRight` alternates per wall so the route has to cross the lane and cross
 * back. Tiles within a wall are emitted from the CLOSED end toward the gap —
 * that is, starting from the side the previous wall's gap dumped the creeps
 * onto. A half-built wall then still blocks the tiles the route is actually
 * using; emitting from the gap end instead would leave the current route wide
 * open until the very last tower, so the bot would pay for most of a wall and
 * get nothing for it.
 */
function serpentine(startY: number, spacing: number, walls: number): Tile[] {
  const out: Tile[] = []
  for (let w = 0; w < walls; w++) {
    const y = startY + w * spacing
    if (y > LAST_ROW) break
    const gapAtRight = w % 2 === 0

    // Wall spans the full width bar one end tile. Emit from the closed end.
    if (gapAtRight) {
      for (let x = 0; x <= GRID_W - 2; x++) out.push({ x, y })
    } else {
      for (let x = GRID_W - 1; x >= 1; x--) out.push({ x, y })
    }
  }
  return out
}

/**
 * Posts: short walls that cross the middle of the lane, alternating anchor.
 *
 * A tooth has to cross the CENTRE COLUMNS or it does nothing at all. The
 * horizontal version of this had teeth anchored at both edges that stopped
 * short of the middle, which left a clear channel from spawn to exit and made
 * the maze exactly as long as an empty lane. The test that measures path length
 * caught it, and the same trap exists rotated: a tooth from the left that stops
 * at x=2 is decoration.
 *
 *   ████████░░░░    from the left, past centre, right side open
 *   ░░░░████████    from the right, past centre, left side open
 *
 * Cheaper per tower than a full serpentine wall and it never risks sealing,
 * which suits a bot that spends most of its gold on sending.
 */
function posts(startY: number, spacing: number, count: number, reach: number): Tile[] {
  const out: Tile[] = []
  // The two central columns. A tooth must cover both to be worth its gold.
  const midRight = GRID_W >> 1
  const midLeft = midRight - 1
  for (let p = 0; p < count; p++) {
    const y = startY + p * spacing
    if (y > LAST_ROW) break
    const fromLeft = p % 2 === 0
    const from = fromLeft ? Math.max(0, midRight - reach) : midLeft
    const to = fromLeft ? midRight : Math.min(GRID_W - 1, midLeft + reach)
    for (let x = from; x <= to; x++) out.push({ x, y })
  }
  return out
}

export interface MazeTemplate {
  readonly name: string
  readonly tiles: readonly Tile[]
}

/**
 * Spacings are in rows now, not columns. A wall every 3 rows over 22 buildable
 * rows is 7 walls of 7 towers — 49 towers, inside the 30-60 a full maze on this
 * board is meant to cost.
 */
export const MAZE_TEMPLATES: readonly MazeTemplate[] = [
  { name: 'serpentine', tiles: serpentine(FIRST_ROW + 1, 3, 8) },
  { name: 'tight serpentine', tiles: serpentine(FIRST_ROW, 2, 12) },
  { name: 'posts', tiles: posts(FIRST_ROW + 1, 2, 11, 4) },
]

export function templateAt(index: number): MazeTemplate {
  return MAZE_TEMPLATES[index % MAZE_TEMPLATES.length] as MazeTemplate
}
