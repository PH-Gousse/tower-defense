import {
  TILE_COUNT,
  GRID_W,
  LANE_WIDTH,
  SPAWN_ROWS,
  MAX_TOWERS,
  DIR_DX,
  DIR_DY,
  Dir,
  inBounds,
  footprintCells,
  footprintContains,
  FOOTPRINT_CELLS,
} from './grid'
import { buildField, createField, type FlowField } from './field'

/**
 * Game state.
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
 * Towers: a dense list of anchors, plus a per-tile cache of which tower
 * covers each cell.
 *
 * A tower is `{ id, anchorX, anchorY, kind, level, cooldown }` at slot `i`,
 * and its 2x2 footprint is DERIVED from the anchor (ADR-0019). `at[tile]` is
 * the slot covering that tile, or -1; `Lane.blocked` is the same fact as a
 * byte per tile for the flow field. Both are caches, rebuilt by `insertTower`
 * and `removeTowerSlot` and nowhere else. A tower stored four times over would
 * be four places to disagree.
 *
 * **Slots are kept sorted by anchor tile index.** "Towers fire in tile-index
 * order" is a determinism pin (invariants rule 4), and a sorted list makes it
 * a plain forward loop here, in `hashState`, and in the bot -- the same order
 * everywhere, by construction rather than by each caller remembering to sort.
 * A build shifts at most 800 entries; a sell compacts stably. Both are rare
 * next to a tick.
 *
 * `id` is monotonic per match and never reused. Slots shift when a tower is
 * built or sold ahead of them, so the id is what the renderer keys effects on.
 */
export interface Towers {
  readonly id: Int32Array
  readonly anchorX: Int16Array
  readonly anchorY: Int16Array
  readonly kind: Int8Array
  readonly level: Int8Array
  readonly cooldown: Int32Array
  /** Per tile: slot of the tower covering it, or -1. Cache. */
  readonly at: Int32Array
  count: number
}

export interface Lane {
  /** 1 = inside a tower footprint, 0 = walkable. Cache; index is row-major tile index. */
  readonly blocked: Uint8Array
  readonly field: FlowField
  readonly creeps: Creeps
  readonly towers: Towers
  /**
   * Monotonic count of creeps that have entered here, ever.
   *
   * It is the whole of what used to be a spawn queue. A send puts its creep on
   * the board immediately -- gold is the only thing limiting how fast you can
   * send -- and this counter is what keeps simultaneous arrivals apart, by
   * giving each one a different starting point. See `spawnPointFor`.
   *
   * Counts respawns too: a creep returned to the spawn zone by a leak or by a
   * sealed path takes the next number, so it does not land on top of whatever
   * was just sent.
   */
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
  /** Next tower id to hand out. Monotonic, never reused. */
  nextTowerId: number
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

/**
 * The opening purse and income now live in `data.ts` with the other balance
 * numbers, so the golden fixture can freeze them. Re-exported here because this
 * is where every caller has always found them, and because a live `let` binding
 * survives the re-export -- installing fixture data really does change what
 * `createState` reads.
 */
export { STARTING_GOLD, STARTING_INCOME } from './data'
// `export ... from` re-exports without binding locally, and `createState` below
// needs to READ them. Imported separately, and as live bindings: reading them
// inside `createState` rather than at module load is what makes a fixture's
// installed purse take effect.
import { STARTING_GOLD, STARTING_INCOME } from './data'

/**
 * Lives.
 *
 * A working figure, not a settled constant. The decision the design records is
 * "enough that one bad leak is a crisis with time to respond", and which number
 * delivers that is a tuning question for the harness.
 */
export const STARTING_LIVES = 20

/**
 * Income is paid into gold every INCOME_EVERY_TICKS, and the clock starts when
 * sending opens, not at tick 0 — see SEND_UNLOCK_TICKS. A payout before anyone
 * may send is a period the attacker can never compound.
 */
/** 15 seconds at 20Hz. The decision cadence of the whole game. */
export const INCOME_EVERY_TICKS = 300

export enum MatchResult {
  Playing = 0,
  /** Someone won; `winner` says who. */
  Decided = 1,
  /** Both players hit zero on the same tick. */
  Draw = 2,
}

export const MAX_CREEPS = 65536

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
  const at = new Int32Array(TILE_COUNT)
  at.fill(-1)
  return {
    id: new Int32Array(MAX_TOWERS),
    anchorX: new Int16Array(MAX_TOWERS),
    anchorY: new Int16Array(MAX_TOWERS),
    kind: new Int8Array(MAX_TOWERS),
    level: new Int8Array(MAX_TOWERS),
    cooldown: new Int32Array(MAX_TOWERS),
    at,
    count: 0,
  }
}

function createLane(): Lane {
  const blocked = new Uint8Array(TILE_COUNT)
  return {
    blocked,
    field: buildField(blocked, createField()),
    creeps: createCreeps(),
    towers: createTowers(),
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
    nextTowerId: 1,
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
  into.nextTowerId = from.nextTowerId
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
    dst.released = src.released

    const ts = src.towers
    const td = dst.towers
    const tn = ts.count
    td.id.set(ts.id.subarray(0, tn))
    td.anchorX.set(ts.anchorX.subarray(0, tn))
    td.anchorY.set(ts.anchorY.subarray(0, tn))
    td.kind.set(ts.kind.subarray(0, tn))
    td.level.set(ts.level.subarray(0, tn))
    td.cooldown.set(ts.cooldown.subarray(0, tn))
    td.at.set(ts.at)
    td.count = tn

    // Only the LIVE prefix. Everything at or past `count` is dead space: the
    // arrays are dense, `removeDead` compacts into them, spawns write at
    // `count`, and every reader in the sim -- movement, targeting, the spatial
    // hash, `hashState` -- bounds its loop by `count`. Nothing can observe what
    // is beyond it.
    //
    // This used to copy the whole arrays, which made a tick cost the CAP rather
    // than the match: ten arrays a lane at MAX_CREEPS each, every tick, at
    // 20Hz, however few creeps were actually walking. It is the reason the cap
    // could not simply be raised -- at 65536 a tick copied 6.4MB to move a
    // dozen creeps, and the sim test suite went from 1.4s to 4.4s on that alone.
    const a = src.creeps
    const b = dst.creeps
    const n = a.count
    b.id.set(a.id.subarray(0, n))
    b.owner.set(a.owner.subarray(0, n))
    b.x.set(a.x.subarray(0, n))
    b.y.set(a.y.subarray(0, n))
    b.hp.set(a.hp.subarray(0, n))
    b.laps.set(a.laps.subarray(0, n))
    b.speed.set(a.speed.subarray(0, n))
    b.slowPercent.set(a.slowPercent.subarray(0, n))
    b.slowUntil.set(a.slowUntil.subarray(0, n))
    b.spec.set(a.spec.subarray(0, n))
    b.count = n
  }
  return into
}

// --- towers ------------------------------------------------------------------

const cellScratch = new Int32Array(FOOTPRINT_CELLS)

/** The slot of the tower covering (x, y), or -1. Any footprint cell resolves. */
export function towerSlotAt(lane: Lane, x: number, y: number): number {
  if (!inBounds(x, y)) return -1
  return lane.towers.at[y * GRID_W + x] as number
}

/** The kind of the tower covering (x, y), or -1. */
export function towerKindAt(lane: Lane, x: number, y: number): number {
  const slot = towerSlotAt(lane, x, y)
  return slot === -1 ? -1 : (lane.towers.kind[slot] as number)
}

/** Whether any cell of the footprint at (ax, ay) is already inside a tower. */
export function footprintOverlapsTower(lane: Lane, ax: number, ay: number): boolean {
  footprintCells(ax, ay, cellScratch)
  for (let k = 0; k < FOOTPRINT_CELLS; k++) {
    if (lane.blocked[cellScratch[k] as number] === 1) return true
  }
  return false
}

/** Whether any creep in the lane stands on a cell of the footprint. */
export function creepOnFootprint(lane: Lane, ax: number, ay: number): boolean {
  const c = lane.creeps
  for (let i = 0; i < c.count; i++) {
    const cx = Math.floor(c.x[i] as number)
    const cy = Math.floor(c.y[i] as number)
    if (footprintContains(ax, ay, cx, cy)) return true
  }
  return false
}

/** Stamp the caches for slot `s` with `value` (the slot itself, or -1). */
function stampFootprint(lane: Lane, s: number, value: number): void {
  const t = lane.towers
  footprintCells(t.anchorX[s] as number, t.anchorY[s] as number, cellScratch)
  for (let k = 0; k < FOOTPRINT_CELLS; k++) {
    const cell = cellScratch[k] as number
    t.at[cell] = value
    lane.blocked[cell] = value === -1 ? 0 : 1
  }
}

/**
 * Add a tower, keeping the slots sorted by anchor tile index. Returns the slot.
 *
 * Does NOT rebuild the flow field; the caller does, once, after the caches are
 * consistent. The caller has also already validated the footprint.
 */
export function insertTower(lane: Lane, id: number, ax: number, ay: number, kind: number): number {
  const t = lane.towers
  const anchor = ay * GRID_W + ax
  let p = t.count
  while (p > 0) {
    const q = p - 1
    if ((t.anchorY[q] as number) * GRID_W + (t.anchorX[q] as number) < anchor) break
    p = q
  }
  // Shift [p, count) right by one. The shifted towers' cache entries move with
  // them: re-stamp each at its new slot.
  for (let s = t.count; s > p; s--) {
    const q = s - 1
    t.id[s] = t.id[q] as number
    t.anchorX[s] = t.anchorX[q] as number
    t.anchorY[s] = t.anchorY[q] as number
    t.kind[s] = t.kind[q] as number
    t.level[s] = t.level[q] as number
    t.cooldown[s] = t.cooldown[q] as number
    stampFootprint(lane, s, s)
  }
  t.id[p] = id
  t.anchorX[p] = ax
  t.anchorY[p] = ay
  t.kind[p] = kind
  t.level[p] = 1
  t.cooldown[p] = 0
  t.count += 1
  stampFootprint(lane, p, p)
  return p
}

/** Remove the tower at `slot`, compacting stably. Field rebuild is the caller's. */
export function removeTowerSlot(lane: Lane, slot: number): void {
  const t = lane.towers
  stampFootprint(lane, slot, -1)
  for (let s = slot + 1; s < t.count; s++) {
    const q = s - 1
    t.id[q] = t.id[s] as number
    t.anchorX[q] = t.anchorX[s] as number
    t.anchorY[q] = t.anchorY[s] as number
    t.kind[q] = t.kind[s] as number
    t.level[q] = t.level[s] as number
    t.cooldown[q] = t.cooldown[s] as number
    stampFootprint(lane, q, q)
  }
  t.count -= 1
}

// --- spawning ----------------------------------------------------------------

/**
 * Where a creep appears: spread across the whole spawn zone, plus a fractional
 * setback along the route (ADR-0022).
 *
 * Sending is unpaced -- a purchase puts its creep on the board that tick, and
 * only gold limits how many you buy -- so many creeps can enter on one tick.
 * They must not enter on one POINT. Identical creeps sharing a position move
 * identically forever, so they read as a single dot with N health bars and one
 * splash shot clears the lot, which erases the Splash tower's reason to exist.
 *
 * Three coordinates come out of the lane's release counter:
 *
 *   column   release % LANE_WIDTH            consecutive arrivals form a FRONT
 *   row      (release / LANE_WIDTH) % SPAWN_ROWS   across the zone, then fill it
 *   setback  a fraction of a tile, backwards along `field.dir` at that cell
 *
 * The setback is the load-bearing part, and it is worth saying why because a
 * later reader will be tempted to drop it "since the zone spreads them
 * anyway". Creeps steer centre-to-centre, so any offset ACROSS the route is
 * gone at the first tile boundary; only an offset ALONG the route survives,
 * because it is really a time gap, and centre-snapping preserves time gaps.
 * Two creeps in different cells are not safe either: their walks to the first
 * gap differ by an integer number of tiles, and two cells symmetric about the
 * gap differ by zero, so they would arrive at the gap on the same tick at the
 * same point and be welded for the rest of the match. A setback that is unique
 * per release breaks every such tie: integer differences are >= 1 or 0, the
 * fractions differ by less than SPAWN_SETBACK < 1, so no two of the
 * SPAWN_PERIOD releases ever share a distance-to-anywhere.
 *
 * The setback slot walks the period with a coprime stride so a burst bought on
 * one tick spreads over the whole 0..SPAWN_SETBACK rather than clustering at
 * one end: 22 consecutive releases span it. 81 is coprime with 1760 (2^5.5.11).
 *
 * Direction comes from `field.dir` at the spawn cell, not from "up is back":
 * the zone is open so most cells point S, but a cell beside the first wall can
 * point E or W, and a setback along the wrong axis is lateral -- exactly the
 * offset that welds. Guessing this once cost a day on the old board.
 *
 * SPAWN_PERIOD is the budget: that many arrivals get distinct points before the
 * pattern repeats. It replaces the old 22, and the bot's burst cap is no longer
 * tied to it (see MAX_SEND_BURST in bot.ts).
 */
const SPAWN_SLOTS = 11
export const SPAWN_PERIOD = LANE_WIDTH * SPAWN_ROWS * SPAWN_SLOTS
/** Coprime with SPAWN_PERIOD, so `release * stride mod period` is a bijection. */
const SPAWN_SETBACK_STRIDE = 81
/** Furthest back a creep may start. Under 0.5 so `floor` stays on its tile. */
const SPAWN_SETBACK = 0.45

export function spawnPointFor(release: number, field: FlowField): { x: number; y: number } {
  const n = release % SPAWN_PERIOD
  const col = n % LANE_WIDTH
  const row = ((n - col) / LANE_WIDTH) % SPAWN_ROWS
  const slot = (n * SPAWN_SETBACK_STRIDE) % SPAWN_PERIOD
  const back = ((slot + 0.5) / SPAWN_PERIOD) * SPAWN_SETBACK
  const d = field.dir[row * GRID_W + col] as number
  // A sealed lane has no direction to step back along. Centre, and let the
  // no-path branch in `moveCreeps` sort it out on the next tick.
  if (d === Dir.None) return { x: col + 0.5, y: row + 0.5 }
  return {
    x: col + 0.5 - (DIR_DX[d] as number) * back,
    y: row + 0.5 - (DIR_DY[d] as number) * back,
  }
}

export { TILE_COUNT, GRID_W }
