import { TILE_COUNT, GRID_W, SPAWN_TILES } from './grid'
import { buildField, createField, type FlowField } from './field'

/**
 * Game state.
 *
 * Step 2 scope: one lane, towers, and creeps walking a flow field. Teams, gold,
 * income, lives and sending arrive at steps 4-6; the shapes below are sized so
 * those land as fields rather than as a reshuffle.
 *
 * Two properties this file exists to protect:
 *
 *   1. Everything hashable is a number in a typed array or a plain number
 *      field. No Maps, no Sets, no objects with iteration order that could
 *      differ between engines.
 *   2. `step()` returns a new state rather than mutating, so the renderer can
 *      hold the previous tick to interpolate against. Buffers are swapped, not
 *      reallocated - see `cloneState`.
 */

/** A creep's position is stored in tile units as a float. */
export interface Creeps {
  /** Dense arrays, indexed 0..count-1. Creep identity is `id[i]`. */
  readonly id: Int32Array
  readonly x: Float64Array
  readonly y: Float64Array
  readonly hp: Int32Array
  readonly laps: Int32Array
  /** Tiles per tick, before any slow is applied. */
  readonly speed: Float64Array
  /** Movement reduction as an integer percent, active until `slowUntil`. */
  readonly slowPercent: Int32Array
  /** Tick at which the current slow expires. */
  readonly slowUntil: Int32Array
  count: number
}

/**
 * Towers, stored per tile rather than in a dense list.
 *
 * One tower per tile and 960 tiles, so a tile-indexed array is smaller than the
 * bookkeeping a dense list would need — and it makes "fire in tile order", the
 * determinism pin, a plain forward loop.
 *
 * `kind[i] === -1` means no tower.
 */
export interface Towers {
  readonly kind: Int8Array
  readonly level: Int8Array
  readonly cooldown: Int32Array
}

export interface Lane {
  /** 1 = tower present, 0 = walkable. Index is row-major tile index. */
  readonly blocked: Uint8Array
  readonly field: FlowField
  readonly creeps: Creeps
  readonly towers: Towers
}

export interface GameState {
  tick: number
  /** Next creep id to hand out. Monotonic, never reused. */
  nextCreepId: number
  /**
   * Gold in hand.
   *
   * Step 4 has a fixed budget and no income: enough to make build, upgrade and
   * sell mean something, without pretending the economy exists. Income ticks,
   * kill bounty and tier unlocks arrive at step 6.
   */
  gold: number
  /** Creeps killed this match. Kill bounty pays off this at step 6. */
  kills: number
  /**
   * Lives remaining for this lane's owner.
   *
   * A leak costs one. The sender gains nothing — lives only ever go down, for
   * everyone. That asymmetry is the damping term: crediting the sender would
   * make a leak a 2-point swing, so a leader would compound in lives and income
   * at once and there may be no constants that keep that non-degenerate.
   */
  lives: number
  /** Total leaks this match, including ones that did not end it. */
  leaks: number
  result: MatchResult
  readonly lane: Lane
}

export const STARTING_GOLD = 600

/**
 * Lives.
 *
 * A working figure, not a settled constant. The decision the design records is
 * "enough that one bad leak is a crisis with time to respond", and which number
 * delivers that is a tuning question for the harness.
 */
export const STARTING_LIVES = 20

export enum MatchResult {
  Playing = 0,
  /** This lane's owner ran out of lives. */
  Defeat = 1,
}

export const MAX_CREEPS = 2048

function createCreeps(): Creeps {
  return {
    id: new Int32Array(MAX_CREEPS),
    x: new Float64Array(MAX_CREEPS),
    y: new Float64Array(MAX_CREEPS),
    hp: new Int32Array(MAX_CREEPS),
    laps: new Int32Array(MAX_CREEPS),
    speed: new Float64Array(MAX_CREEPS),
    slowPercent: new Int32Array(MAX_CREEPS),
    slowUntil: new Int32Array(MAX_CREEPS),
    count: 0,
  }
}

function createTowers(): Towers {
  const kind = new Int8Array(TILE_COUNT)
  kind.fill(-1)
  return { kind, level: new Int8Array(TILE_COUNT), cooldown: new Int32Array(TILE_COUNT) }
}

export function createState(): GameState {
  const blocked = new Uint8Array(TILE_COUNT)
  const field = buildField(blocked, createField())
  return {
    tick: 0,
    nextCreepId: 1,
    gold: STARTING_GOLD,
    kills: 0,
    lives: STARTING_LIVES,
    leaks: 0,
    result: MatchResult.Playing,
    lane: { blocked, field, creeps: createCreeps(), towers: createTowers() },
  }
}

/**
 * Deep copy into `into`, allocating only on the first call.
 *
 * The driver keeps two states and alternates between them, so a match allocates
 * two of everything and then nothing per tick. At 20Hz for twenty minutes that
 * is the difference between two allocations and 24,000.
 */
export function cloneState(from: GameState, into: GameState): GameState {
  into.tick = from.tick
  into.nextCreepId = from.nextCreepId
  into.gold = from.gold
  into.kills = from.kills
  into.lives = from.lives
  into.leaks = from.leaks
  into.result = from.result
  into.lane.towers.kind.set(from.lane.towers.kind)
  into.lane.towers.level.set(from.lane.towers.level)
  into.lane.towers.cooldown.set(from.lane.towers.cooldown)
  into.lane.blocked.set(from.lane.blocked)
  into.lane.field.dist.set(from.lane.field.dist)
  into.lane.field.dir.set(from.lane.field.dir)
  const a = from.lane.creeps
  const b = into.lane.creeps
  b.id.set(a.id)
  b.x.set(a.x)
  b.y.set(a.y)
  b.hp.set(a.hp)
  b.laps.set(a.laps)
  b.speed.set(a.speed)
  b.slowPercent.set(a.slowPercent)
  b.slowUntil.set(a.slowUntil)
  b.count = a.count
  return into
}

/** Spawn tiles are used in release order, alternating between the two. */
export function spawnPointFor(release: number): { x: number; y: number } {
  const t = SPAWN_TILES[release % SPAWN_TILES.length] as { x: number; y: number }
  return { x: t.x + 0.5, y: t.y + 0.5 }
}

export function addCreep(
  state: GameState,
  hp: number,
  speed: number,
  release: number,
): void {
  const c = state.lane.creeps
  if (c.count >= MAX_CREEPS) return
  const i = c.count
  const p = spawnPointFor(release)
  c.id[i] = state.nextCreepId
  c.x[i] = p.x
  c.y[i] = p.y
  c.hp[i] = hp
  c.laps[i] = 0
  c.speed[i] = speed
  c.count = i + 1
  state.nextCreepId += 1
}

export { TILE_COUNT, GRID_W }
