import { GRID_W, GRID_H } from '@ltw/sim'
import { fitGround, DEFAULT_FOV_DEG, DEFAULT_PITCH_DEG } from './render/CameraRig'

/**
 * Where the HUD and the palette sit, and what that reserves from the camera.
 *
 * The board is 20 tiles across and 24 down, so on a landscape screen the
 * camera's fit is bound by HEIGHT and some horizontal space is free. That is
 * the argument for rails: the bars were costing 136px of 830 on the one axis
 * with no slack, and moving them sideways takes the board from 694px tall to
 * the full 830 (+44% area) without touching the camera's maths.
 *
 *   landscape, bars (before)          landscape, rails (after)
 *   +---------------------------+     +---+-------------------+---+
 *   |########## HUD ############|     |###|                   |###|
 *   +---------------------------+     |###|                   |###|
 *   |                           |     |HUD|       board       |pal|
 *   |          board            |     |###|    (full height)  |###|
 *   |                           |     |###|                   |###|
 *   +---------------------------+     |###|                   |###|
 *   |######## palette ##########|     +---+-------------------+---+
 *   +---------------------------+
 *   safeV = max(hud, palette)         safeH = rail, safeV = 0
 *   costs 2x the TALLER bar           costs nothing WHILE height-bound
 *
 * That last word is the whole difficulty. Take too much width and the fit flips
 * to width-bound, at which point the board starts SHRINKING while the UI looks
 * like it gained room -- the change makes things worse and looks like progress.
 *
 * The first version of this module capped the rail at a constant fraction of
 * the viewport width, measured at 25%. That was wrong twice over. It was
 * measured with the bars still in place, so `safeV` was still eating height and
 * the fit had slack it does not have once the bars move; and the free width is
 * not a property of WIDTH at all, it is a property of the viewport's ASPECT
 * against the board's. The board's rectangle is about 0.835 wide-to-tall, so a
 * 3440x1440 screen has ~30% per side free while a square 900x900 has ~2.8% --
 * a single fraction cannot describe both, and the one that fits a laptop
 * silently flips a square window to width-bound.
 *
 * So the rule is not a fraction. It asks the camera's own fit maths for the
 * widest rail that keeps the vertical constraint binding, and takes that. A
 * change to the field of view moves this automatically instead of quietly
 * invalidating a tuned number.
 */

/** Gap between the two lanes, in tiles. The camera and the layout must agree. */
export const OPP_GAP = 4

/** Full content width in tiles: your lane, the gap, theirs. */
export const CONTENT_W = GRID_W * 2 + OPP_GAP

/** Margin `fitBounds` applies around the content rectangle. */
const MARGIN = 1.06

const DEG = Math.PI / 180

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
 * The exact crossover is where the two constraints are equal, and sitting on it
 * means any rounding lands on the wrong side. Nine tenths keeps the fit clearly
 * height-bound rather than marginally so.
 */
const RAIL_SAFETY = 0.9

/**
 * The widest rail, in px per side, that leaves the fit bound by height.
 *
 * Solved by asking `fitGround` rather than by algebra against it, so the two can
 * never disagree: whatever the rig computes is what this is measured against.
 * Returns 0 when even a zero-width rail would be width-bound, which cannot
 * happen on a landscape viewport but is the honest answer if it ever did.
 */
export function maxHeightBoundRail(viewW: number, viewH: number): number {
  const halfW = (CONTENT_W / 2) * MARGIN
  const halfD = (GRID_H / 2) * MARGIN
  const pitch = DEFAULT_PITCH_DEG * DEG
  const fov = DEFAULT_FOV_DEG * DEG

  // In the rail layout the vertical safe area is zero, so `usableY` is 1 and
  // `fitBounds`'s effective fov and aspect reduce to the raw ones.
  const heightBound = (rail: number): boolean => {
    const usableX = Math.max(0.2, (viewW - 2 * rail) / viewW)
    const aspectEff = (viewW / viewH) * usableX
    const both = fitGround(halfW, halfD, pitch, fov, aspectEff)
    const verticalOnly = fitGround(0, halfD, pitch, fov, aspectEff)
    return both.distance <= verticalOnly.distance + 1e-9
  }

  if (!heightBound(0)) return 0

  // Bisect rather than step: exact to a pixel in ~11 iterations regardless of
  // how wide the screen is, where a fixed step is either slow or coarse.
  let lo = 0
  let hi = Math.floor(viewW / 2)
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (heightBound(mid)) lo = mid
    else hi = mid
  }
  return lo
}

/**
 * Rail width per side, or 0 when the chrome should stay in horizontal bars.
 *
 * Portrait gets bars: two rails plus a readable board does not fit across a
 * phone, and `scene.ts` already frames a single lane there for the same reason.
 */
export function railWidth(viewW: number, viewH: number): number {
  if (viewH > viewW) return 0
  const free = Math.floor(maxHeightBoundRail(viewW, viewH) * RAIL_SAFETY)
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
