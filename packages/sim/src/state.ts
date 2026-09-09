import { TILE_COUNT, GRID_W, SPAWN_TILES, DIR_DX, DIR_DY, Dir } from './grid'
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
   * Monotonic count of creeps that have entered here, ever.
   *
   * It is the whole of what used to be a spawn queue. A send puts its creep on
   * the board immediately -- gold is the only thing limiting how fast you can
   * send -- and this counter is what keeps simultaneous arrivals apart, by
   * giving each one a different starting point. See `spawnPointFor`.
   *
   * Counts respawns too: a creep returned to the entrance by a leak or by a
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
  const kind = new Int8Array(TILE_COUNT)
  kind.fill(-1)
  return { kind, level: new Int8Array(TILE_COUNT), cooldown: new Int32Array(TILE_COUNT) }
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
    dst.released = src.released

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

/**
 * Distinct starting points for creeps that arrive together.
 *
 * Sending is unpaced -- a purchase puts its creep on the board that tick, and
 * only gold limits how many you buy -- so twenty creeps can enter on one tick.
 * They must not enter on one POINT. Identical creeps sharing a position move
 * identically forever, so they read as a single dot with twenty health bars and
 * one splash shot clears the lot, which erases the Splash tower's reason to
 * exist. That is what the old spawn queue was for, and this replaces it.
 *
 * Spreading them ACROSS the entrance does not work, and it is worth saying why
 * because it is the obvious fix. Creeps steer centre-to-centre: `moveCreeps`
 * aims at `cx + DIR_DX[d] + 0.5`, so whatever sideways offset a creep starts
 * with is gone the first time it crosses a tile boundary, and once two creeps
 * share a tile heading the same way they are welded together.
 *
 *     across the entrance          after one tile transition
 *     ┌───────────┐                ┌───────────┐
 *     │ o o o o o │  ────────────▶ │     O     │   welded: one splash kills all
 *     └───────────┘                └───────────┘
 *
 *     along the path               after one tile transition
 *     ┌───────────┐                ┌───────────┐
 *     │     o     │  y = 0.5       │     o     │   a distance gap became a TIME
 *     │     o     │  y = 0.4  ───▶ │     o     │   gap, and centre-snapping
 *     │     o     │  y = 0.3       │     o     │   preserves time gaps
 *     └───────────┘                └───────────┘
 *
 * So the offset goes BACKWARDS ALONG THE ROUTE instead, and it has to read the
 * flow field to know which way that is. Guessing costs a day: the lane runs top
 * to bottom, so "back" looks like -y, but the route leaves the entrance row
 * heading EAST and only turns south at the far column. A y-offset there is
 * lateral, and worse than useless -- creeps at 0.955 and 0.045 are both 0.455
 * from the centre they steer to, so they arrive on the same tick at the same
 * point and weld, which is the exact failure being prevented. `field.dir` at
 * the spawn tile is the only thing that knows which way is forward.
 *
 * Stepping back along it makes the walk to the next centre longer by exactly
 * the offset, so a creep set back by 0.3 stays 0.3 behind for the rest of the
 * match, through every turn, at every speed.
 *
 * Tile and slot advance together on `release`, and 2 and 11 are coprime, so the
 * pair repeats every 22. That number is a budget, not a decoration: 22 creeps
 * arriving on one tick get 22 distinct points, and the 23rd starts exactly where
 * the first did. Creeps that share a point on the same tick are welded for the
 * rest of the match, so `MAX_SEND_BURST` in bot.ts is held at 22 to match. A
 * player cannot outrun it either: a tick is 50ms, so even two ×10 buttons
 * pressed together stay inside the budget.
 *
 * SPAWN_PERIOD is what to raise if a bigger single-tick burst ever becomes
 * possible -- and raising it is nearly free, because the slots subdivide a tile
 * that is 1.0 across and nothing else depends on the gap being any given size.
 *
 * What it deliberately does NOT try to do is spread a mass send beyond splash
 * range. Splash reaches 1.2 tiles and the entrance is one tile wide, so a wave
 * bought in one instant is a wave one blast can catch, and that is the intended
 * counter rather than a defect. The job here is only that no two creeps are the
 * SAME creep.
 */
const SPAWN_SLOTS = 11
export const SPAWN_PERIOD = SPAWN_TILES.length * SPAWN_SLOTS
/** Furthest back a creep may start. Under 0.5 so `floor` stays on its tile. */
const SPAWN_SETBACK = 0.45

export function spawnPointFor(release: number, field: FlowField): { x: number; y: number } {
  const t = SPAWN_TILES[release % SPAWN_TILES.length] as { x: number; y: number }
  const slot = release % SPAWN_SLOTS
  const back = ((slot + 0.5) / SPAWN_SLOTS) * SPAWN_SETBACK
  const d = field.dir[t.y * GRID_W + t.x] as number
  // A sealed lane has no direction to step back along. Centre, and let the
  // teleport-to-spawn path in `moveCreeps` sort it out on the next tick.
  if (d === Dir.None) return { x: t.x + 0.5, y: t.y + 0.5 }
  return {
    x: t.x + 0.5 - (DIR_DX[d] as number) * back,
    y: t.y + 0.5 - (DIR_DY[d] as number) * back,
  }
}


export { TILE_COUNT, GRID_W }
