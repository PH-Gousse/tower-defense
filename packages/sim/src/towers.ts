import { GRID_W, GRID_H, TILE_COUNT, tileX, tileY } from './grid'
import { UNREACHABLE } from './field'
import { TowerKind, levelOf, ARCHETYPES, type TowerArchetype } from './data'
import type { GameState, Lane } from './state'

/**
 * Tower firing, and the spatial hash that makes it affordable.
 *
 * Naive targeting is "every tower scans every creep": O(towers x creeps) every
 * tick, and both are bounded only by gold. The hash buckets creeps by tile so a
 * tower only looks at the tiles its range actually covers.
 *
 *   creeps ──▶ counting sort by tile ──▶ bucketStart[] + bucketItems[]
 *                                              │
 *   tower at tile t, range r ──▶ bounding box ─┘──▶ candidates ──▶ nearest exit
 *
 * Three ordered operations live in this file, and every one is a determinism
 * pin rather than a preference:
 *
 *   1. Towers fire in tile-index order.
 *   2. Bucket contents are in creep-array order, which is ascending id,
 *      because the counting sort fills them by walking creeps in order.
 *   3. Targeting picks the lowest `dist` — the creep nearest the exit —
 *      breaking ties on ascending creep id.
 *
 * Two clients disagreeing on any of the three is a desync, and it would show up
 * as "a tower shot a different creep", which is invisible until the hash
 * diverges.
 */

/** Rebuilt every tick by counting sort. No allocation after construction. */
export interface SpatialHash {
  /** bucketStart[t] .. bucketStart[t+1] indexes into bucketItems for tile t. */
  readonly bucketStart: Int32Array
  /** Creep indices, grouped by tile, ascending within each bucket. */
  readonly bucketItems: Int32Array
  readonly counts: Int32Array
}

export function createSpatialHash(maxCreeps: number): SpatialHash {
  return {
    bucketStart: new Int32Array(TILE_COUNT + 1),
    bucketItems: new Int32Array(maxCreeps),
    counts: new Int32Array(TILE_COUNT),
  }
}

/**
 * Counting sort creeps into per-tile buckets.
 *
 * O(tiles + creeps), no allocation, and stable: creeps land in each bucket in
 * array order, which is ascending id. That stability is what gives targeting
 * its tiebreak for free.
 */
export function rebuildHash(lane: Lane, hash: SpatialHash): void {
  const c = lane.creeps
  const { bucketStart, bucketItems, counts } = hash
  counts.fill(0)

  for (let i = 0; i < c.count; i++) {
    const t = tileOf(c.x[i] as number, c.y[i] as number)
    counts[t] = (counts[t] as number) + 1
  }

  let running = 0
  for (let t = 0; t < TILE_COUNT; t++) {
    bucketStart[t] = running
    running += counts[t] as number
  }
  bucketStart[TILE_COUNT] = running

  // Reuse counts as a per-bucket write cursor.
  counts.fill(0)
  for (let i = 0; i < c.count; i++) {
    const t = tileOf(c.x[i] as number, c.y[i] as number)
    const at = (bucketStart[t] as number) + (counts[t] as number)
    bucketItems[at] = i
    counts[t] = (counts[t] as number) + 1
  }
}

function tileOf(x: number, y: number): number {
  let tx = Math.floor(x)
  let ty = Math.floor(y)
  if (tx < 0) tx = 0
  if (tx >= GRID_W) tx = GRID_W - 1
  if (ty < 0) ty = 0
  if (ty >= GRID_H) ty = GRID_H - 1
  return ty * GRID_W + tx
}

/**
 * Fire every tower that is off cooldown.
 *
 * Towers are walked in tile-index order. Damage is instant with no projectile
 * travel, so a shot resolves in the tick it is fired.
 */
export function fireTowers(state: GameState, lane: Lane, hash: SpatialHash): void {
  const t = lane.towers
  const c = lane.creeps

  for (let i = 0; i < TILE_COUNT; i++) {
    if (t.kind[i] === -1) continue
    const cd = t.cooldown[i] as number
    if (cd > 0) {
      t.cooldown[i] = cd - 1
      continue
    }

    const kind = t.kind[i] as TowerKind
    const level = t.level[i] as number
    const spec = levelOf(kind, level)
    const target = findTarget(lane, hash, i, spec.range)
    if (target === -1) continue

    t.cooldown[i] = spec.cooldownTicks

    if (kind === TowerKind.Splash) {
      const arch = ARCHETYPES[TowerKind.Splash] as TowerArchetype
      const radius = arch.splashRadius ?? 1
      damageAround(lane, hash, target, radius, spec.damage)
    } else {
      c.hp[target] = (c.hp[target] as number) - spec.damage
      if (kind === TowerKind.Slow) {
        const arch = ARCHETYPES[TowerKind.Slow] as TowerArchetype
        const pct = spec.slowPercent ?? 0
        // Strongest slow wins rather than stacking; stacking would let three
        // cheap towers stop a creep dead, which is a different game.
        if (pct >= (c.slowPercent[target] as number)) {
          c.slowPercent[target] = pct
          c.slowUntil[target] = state.tick + (arch.slowTicks ?? 0)
        }
      }
    }
  }
}

/**
 * The in-range creep nearest the exit, tiebroken by ascending creep id.
 *
 * "Nearest the exit" is the flow field's `dist`, already computed — one integer
 * lookup rather than a geometric comparison. Note the consequence, which is
 * real and unresolved: towers permanently focus whichever creep is furthest
 * along, so a long-lived tank soaks every shot while fresh creeps walk behind
 * it. Whether that is a feature or degenerate is a tuning question for the
 * harness at step 8.
 */
function findTarget(
  lane: Lane,
  hash: SpatialHash,
  towerTile: number,
  range: number,
): number {
  const c = lane.creeps
  const field = lane.field
  const tx = tileX(towerTile) + 0.5
  const ty = tileY(towerTile) + 0.5
  const r2 = range * range

  let best = -1
  let bestDist = UNREACHABLE
  let bestId = 0

  const minX = clampX(Math.floor(tx - range))
  const maxX = clampX(Math.floor(tx + range))
  const minY = clampY(Math.floor(ty - range))
  const maxY = clampY(Math.floor(ty + range))

  // Row-major over the bounding box: another fixed iteration order.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = y * GRID_W + x
      const from = hash.bucketStart[tile] as number
      const to = hash.bucketStart[tile + 1] as number
      for (let k = from; k < to; k++) {
        const ci = hash.bucketItems[k] as number
        if ((c.hp[ci] as number) <= 0) continue
        const dx = (c.x[ci] as number) - tx
        const dy = (c.y[ci] as number) - ty
        if (dx * dx + dy * dy > r2) continue

        const d = field.dist[tileOf(c.x[ci] as number, c.y[ci] as number)] as number
        const id = c.id[ci] as number
        if (d < bestDist || (d === bestDist && id < bestId)) {
          best = ci
          bestDist = d
          bestId = id
        }
      }
    }
  }
  return best
}

/** Splash: everything within `radius` of the target takes full damage. */
function damageAround(
  lane: Lane,
  hash: SpatialHash,
  target: number,
  radius: number,
  damage: number,
): void {
  const c = lane.creeps
  const cx = c.x[target] as number
  const cy = c.y[target] as number
  const r2 = radius * radius

  const minX = clampX(Math.floor(cx - radius))
  const maxX = clampX(Math.floor(cx + radius))
  const minY = clampY(Math.floor(cy - radius))
  const maxY = clampY(Math.floor(cy + radius))

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const tile = y * GRID_W + x
      const from = hash.bucketStart[tile] as number
      const to = hash.bucketStart[tile + 1] as number
      for (let k = from; k < to; k++) {
        const ci = hash.bucketItems[k] as number
        if ((c.hp[ci] as number) <= 0) continue
        const dx = (c.x[ci] as number) - cx
        const dy = (c.y[ci] as number) - cy
        if (dx * dx + dy * dy > r2) continue
        c.hp[ci] = (c.hp[ci] as number) - damage
      }
    }
  }
}

function clampX(v: number): number {
  if (v < 0) return 0
  if (v >= GRID_W) return GRID_W - 1
  return v
}

function clampY(v: number): number {
  if (v < 0) return 0
  if (v >= GRID_H) return GRID_H - 1
  return v
}
