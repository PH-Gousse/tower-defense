import type { Towers } from '@ltw/sim'

/**
 * The visible band of rows, and which instances fall inside it.
 *
 * `spanningInstances` turns three.js frustum culling OFF for every instanced
 * mesh, for a reason that still holds (see instances.ts): the library's lazy
 * bounding sphere is cached empty on the first frame and inverts the test.
 * While the camera fitted the whole board that cost nothing, because
 * everything was on screen. It scrolls a 213-row lane now (ADR-0024) and
 * shows twenty rows of it, so a mesh holding every tower in the match would
 * push ninety per cent of its vertices through the pipeline to be clipped.
 *
 * So the culling is done here, by row, before the instances are written:
 * only towers and creeps inside the visible band plus a margin get a slot.
 * Towers are cheap to band because the sim keeps them sorted by anchor tile
 * index, row-major, so the towers in a range of rows are one contiguous run
 * of slots and two binary searches find it. Creeps are filtered as they are
 * written, which the per-creep loop was doing anyway.
 *
 * The margin covers what hangs into view from just outside: a tower is
 * TOWER_SIZE rows tall, the tallest model leans a couple of rows toward the
 * camera under the pitch, and a creep drawn a row outside the band would pop.
 */

export interface RowBand {
  /** First and last row (inclusive) whose instances should be drawn. */
  first: number
  last: number
}

/**
 * The band for a view whose ground box runs from `minZ` to `maxZ`, widened
 * by `margin` rows either side and clamped to the lane.
 */
export function rowBand(minZ: number, maxZ: number, margin: number, laneRows: number, out: RowBand): RowBand {
  let first = Math.floor(minZ) - margin
  let last = Math.ceil(maxZ) + margin
  if (first < 0) first = 0
  if (last > laneRows - 1) last = laneRows - 1
  if (last < first) last = first
  out.first = first
  out.last = last
  return out
}

/**
 * The slot range `[start, end)` of towers whose anchor row lies in
 * `[first, last]`, on a list sorted by anchor tile index.
 *
 * Row-major order means anchor rows are non-decreasing along the list, so the
 * usual lower-bound search applies twice: the first slot at or after `first`,
 * and the first slot after `last`. Both are O(log n) on up to 800 towers.
 */
export function towerSlotRange(
  towers: Towers,
  first: number,
  last: number,
  out: { start: number; end: number },
): { start: number; end: number } {
  out.start = lowerBound(towers, first)
  out.end = lowerBound(towers, last + 1)
  if (out.end < out.start) out.end = out.start
  return out
}

/** First slot whose anchor row is >= `row`, or `count`. */
function lowerBound(towers: Towers, row: number): number {
  let lo = 0
  let hi = towers.count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((towers.anchorY[mid] as number) < row) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Whether a creep at lane-local row `z` is inside the band. */
export function inBand(z: number, band: RowBand): boolean {
  return z >= band.first && z < band.last + 1
}
