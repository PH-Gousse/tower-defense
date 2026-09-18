import { LANE_WIDTH, LANE_GAP, GRID_W } from '@ltw/sim'

/**
 * Where the HUD and the palette sit, and what that reserves from the camera.
 *
 * The chrome is either two BARS (top and bottom) or two RAILS (left and
 * right). Bars spend height; rails spend width. Which is free depends on the
 * viewport's aspect against what the camera wants to show.
 *
 *   landscape, bars                    landscape, rails
 *   +---------------------------+     +---+-------------------+---+
 *   |########## HUD ############|     |###|                   |###|
 *   +---------------------------+     |###|                   |###|
 *   |                           |     |HUD|       lane        |pal|
 *   |          lane             |     |###|    (full height)  |###|
 *   |                           |     |###|                   |###|
 *   +---------------------------+     |###|                   |###|
 *   |######## palette ##########|     +---+-------------------+---+
 *   +---------------------------+
 *   safeV = max(hud, palette)         safeH = rail, safeV = 0
 *
 * Under the old 8x24 board the camera FIT the whole board, and the rail's
 * width was the widest that kept that fit height-bound: `fitGround` was asked
 * directly. The camera scrolls now (ADR-0024) and frames a fixed number of
 * rows, so there is no fit to keep height-bound -- the question is what the
 * default framing must still show ACROSS. The rule: after the rails, the
 * usable view at `PLAY_ROWS_IN_VIEW` rows must still show your whole lane,
 * the gap and a strip of the opponent's, with a tile of margin. That is
 * `MIN_VIEW_ASPECT`, derived from the lane constants so a geometry change
 * moves it rather than quietly invalidating a tuned number.
 *
 * Why a strip of the other lane rather than all of it: the rule was set when
 * the default was 20 rows, where both lanes with margin (40 tiles at 17 wide)
 * needed an aspect of 2.0 that no common screen reaches once chrome is
 * subtracted. At 30 rows that aspect is 1.33 and a wide screen does show both
 * lanes, but the rule still asks only for the strip, so a laptop keeps its
 * rails. Panning and the lane-swap hotkey are how the opponent's maze is read
 * (ADR-0024, ADR-0029).
 */

/** Gap between the two lanes, in tiles. The camera and the layout must agree. */
export const OPP_GAP = LANE_GAP

/** Full content width in tiles: your lane, the gap, theirs. */
export const CONTENT_W = GRID_W * 2 + OPP_GAP

/**
 * Tiles the default framing must show across: your lane, the gap, a margin
 * tile each side, and TOWER-width strip of the opponent's lane so its edge is
 * visibly there.
 */
export const MIN_VIEW_TILES = LANE_WIDTH + LANE_GAP + 2 + 2

/**
 * The framing the rails are sized against: the one a player spends the match
 * at, not the one a match opens on.
 *
 * These were the same number until 2026-09-18, when a match began opening at
 * the zoom cap (40 rows, the user's ask). Deriving the rails from the opening
 * view would have widened every rail -- a view that far out leaves more free
 * width -- and a rail's width IS the camera's reservation, so the chrome would
 * have grown because of where the camera starts rather than where it is played.
 */
export const PLAY_ROWS_IN_VIEW = 30

/** The usable viewport aspect below which rails would cost the playing view. */
export const MIN_VIEW_ASPECT = MIN_VIEW_TILES / PLAY_ROWS_IN_VIEW

/** Widest a rail may be. Beyond this the rail is padding, not content. */
export const RAIL_MAX = 300

/**
 * Narrowest a rail may be before it stops being usable.
 *
 * A tower card is `min-width: 132px` in the stylesheet and the rail adds
 * padding either side. Below this the cards would shrink or wrap, and a
 * wrapping rail changes its own width -- exactly what the safe area cannot
 * tolerate. Falling back to horizontal bars is the honest answer.
 */
export const RAIL_MIN = 150

/**
 * Safety factor on the computed ceiling.
 *
 * The exact crossover is where the usable aspect equals `MIN_VIEW_ASPECT`, and
 * sitting on it means any rounding lands on the wrong side. Nine tenths keeps
 * the default view clearly wide enough rather than marginally so.
 */
const RAIL_SAFETY = 0.9

/**
 * The widest rail, in px per side, that leaves the usable view at least
 * `MIN_VIEW_ASPECT` wide for its height. 0 when even no rail would.
 */
export function maxRail(viewW: number, viewH: number): number {
  const free = viewW - MIN_VIEW_ASPECT * viewH
  return free > 0 ? Math.floor(free / 2) : 0
}

/**
 * Rail width per side, or 0 when the chrome should stay in horizontal bars.
 *
 * Portrait gets bars: two rails plus a readable lane does not fit across a
 * phone, and the camera already frames your lane alone there.
 */
export function railWidth(viewW: number, viewH: number): number {
  if (viewH > viewW) return 0
  const free = Math.floor(maxRail(viewW, viewH) * RAIL_SAFETY)
  const w = Math.min(RAIL_MAX, free)
  return w >= RAIL_MIN ? w : 0
}

/** True when the chrome is laid out as side rails rather than top/bottom bars. */
export function usesRails(viewW: number, viewH: number): boolean {
  return railWidth(viewW, viewH) > 0
}

export interface SafeEdges {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

/**
 * What to hand `CameraRig.setSafeArea` for a given layout.
 *
 * The rig takes all four edges already and reduces them to `safeV = max(top,
 * bottom)` and `safeH = max(left, right)`, so this only has to put the measured
 * sizes on the correct pair. Bars measure heights; rails measure widths.
 *
 * `rail` is passed rather than re-derived so the caller reserves the element it
 * actually rendered. A rail a pixel off what `railWidth` predicted -- a
 * scrollbar, a subpixel rounding -- must reserve what is really there.
 */
export function safeEdges(rail: number, hudPx: number, palettePx: number): SafeEdges {
  if (rail > 0) return { top: 0, right: rail, bottom: 0, left: rail }
  return { top: hudPx, right: 0, bottom: palettePx, left: 0 }
}
