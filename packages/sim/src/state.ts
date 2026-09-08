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
  /** Who sent this creep. Owned by the sender, resident in the defender's lane. */
  readonly owner: Int8Array
  /** Index into CREEPS, so bounty and stats are recoverable on death. */
  readonly spec: Int32Array
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
  /**
   * Per-lane spawn queue.
   *
   * A send enqueues its creeps here; the lane releases one every
   * SPAWN_EVERY_TICKS. Six identical creeps entering on the same tick at the
   * same tile would never separate — they would travel as a single point and
   * one splash hit would kill all of them, which erases the Splash tower's
   * entire reason to exist.
   *
   * `queueOwner` records who sent each pending creep, because a creep is owned
   * by its sender for scoring but exists only in the defender's lane.
   */
  readonly queueCreep: Int32Array
  readonly queueOwner: Int8Array
  queueHead: number
  queueTail: number
  /** Ticks until the next release. */
  nextRelease: number
  /** Monotonic count of creeps released here; drives spawn-tile alternation. */
  released: number
}

/** A player. Lane `i` is defended by player `i`. */
export interface Player {
  gold: number
  income: number
  lives: number
  leaks: number
  kills: number
}

export interface GameState {
  tick: number
  /** Next creep id to hand out. Monotonic, never reused. */
  nextCreepId: number
  result: MatchResult
  /** Index of the winning player once `result` is not Playing; -1 for a draw. */
  winner: number
  /** players[i] defends lanes[i]. */
  readonly players: readonly Player[]
  readonly lanes: readonly Lane[]
}

export const PLAYER_COUNT = 2

/** The lane a player sends INTO. A creep never appears in its owner's lane. */
export function opponentOf(player: number): number {
  return player === 0 ? 1 : 0
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

/**
 * Income paid into gold every INCOME_EVERY_TICKS. Sending is the only way it grows.
 *
 * The clock starts when sending opens, not at tick 0 — see SEND_UNLOCK_TICKS.
 * A payout before anyone may send is a period the attacker can never compound.
 */
export const STARTING_INCOME = 25
/** 15 seconds at 20Hz. The decision cadence of the whole game. */
export const INCOME_EVERY_TICKS = 300
/** Ticks between spawn-queue releases. */
export const SPAWN_EVERY_TICKS = 4

export enum MatchResult {
  Playing = 0,
  /** Someone won; `winner` says who. */
  Decided = 1,
  /** Both players hit zero on the same tick. */
  Draw = 2,
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
    owner: new Int8Array(MAX_CREEPS),
    spec: new Int32Array(MAX_CREEPS),
    count: 0,
  }
}

function createTowers(): Towers {
  const kind = new Int8Array(TILE_COUNT)
  kind.fill(-1)
  return { kind, level: new Int8Array(TILE_COUNT), cooldown: new Int32Array(TILE_COUNT) }
}

const QUEUE_CAP = 512

function createLane(): Lane {
  const blocked = new Uint8Array(TILE_COUNT)
  return {
    blocked,
    field: buildField(blocked, createField()),
    creeps: createCreeps(),
    towers: createTowers(),
    queueCreep: new Int32Array(QUEUE_CAP),
    queueOwner: new Int8Array(QUEUE_CAP),
    queueHead: 0,
    queueTail: 0,
    nextRelease: 0,
    released: 0,
  }
}

function createPlayer(): Player {
  return {
    gold: STARTING_GOLD,
    income: STARTING_INCOME,
    lives: STARTING_LIVES,
    leaks: 0,
    kills: 0,
  }
}

export function createState(): GameState {
  return {
    tick: 0,
    nextCreepId: 1,
    result: MatchResult.Playing,
    winner: -1,
    players: [createPlayer(), createPlayer()],
    lanes: [createLane(), createLane()],
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
  into.result = from.result
  into.winner = from.winner

  for (let p = 0; p < PLAYER_COUNT; p++) {
    const src = from.players[p] as Player
    const dst = into.players[p] as Player
    dst.gold = src.gold
    dst.income = src.income
    dst.lives = src.lives
    dst.leaks = src.leaks
    dst.kills = src.kills
  }

  for (let l = 0; l < from.lanes.length; l++) {
    const src = from.lanes[l] as Lane
    const dst = into.lanes[l] as Lane
    dst.blocked.set(src.blocked)
    dst.field.dist.set(src.field.dist)
    dst.field.dir.set(src.field.dir)
    dst.towers.kind.set(src.towers.kind)
    dst.towers.level.set(src.towers.level)
    dst.towers.cooldown.set(src.towers.cooldown)
    dst.queueCreep.set(src.queueCreep)
    dst.queueOwner.set(src.queueOwner)
    dst.queueHead = src.queueHead
    dst.queueTail = src.queueTail
    dst.nextRelease = src.nextRelease
    dst.released = src.released

    const a = src.creeps
    const b = dst.creeps
    b.id.set(a.id)
    b.owner.set(a.owner)
    b.x.set(a.x)
    b.y.set(a.y)
    b.hp.set(a.hp)
    b.laps.set(a.laps)
    b.speed.set(a.speed)
    b.slowPercent.set(a.slowPercent)
    b.slowUntil.set(a.slowUntil)
    b.spec.set(a.spec)
    b.count = a.count
  }
  return into
}

/** Spawn tiles are used in release order, alternating between the two. */
export function spawnPointFor(release: number): { x: number; y: number } {
  const t = SPAWN_TILES[release % SPAWN_TILES.length] as { x: number; y: number }
  return { x: t.x + 0.5, y: t.y + 0.5 }
}


export { TILE_COUNT, GRID_W }
