import towersJson from '../data/towers.json' with { type: 'json' }
import creepsJson from '../data/creeps.json' with { type: 'json' }

/**
 * Balance data, loaded once and frozen.
 *
 * Everything tunable lives in `data/*.json` so that step 8 is editing numbers
 * rather than editing code. The golden fixture pins its own frozen copy of
 * these values, so tuning cannot silently change the expected hash — see
 * test/golden.
 *
 * The invariants below are asserted at load rather than trusted. These files
 * get edited hundreds of times during tuning, and a bad number reads as bad
 * balance rather than as a bug, which is the most expensive kind of mistake to
 * chase.
 */

export enum TowerKind {
  Single = 0,
  Splash = 1,
  Slow = 2,
}

export interface TowerLevel {
  readonly cost: number
  readonly damage: number
  readonly range: number
  readonly cooldownTicks: number
  readonly slowPercent?: number
}

export interface TowerArchetype {
  readonly key: string
  readonly name: string
  readonly levels: readonly TowerLevel[]
  readonly splashRadius?: number
  readonly slowTicks?: number
}

interface TowersFile {
  readonly version: number
  readonly sellRefund: number
  readonly acquireTicks: number
  readonly archetypes: readonly TowerArchetype[]
}

const file = towersJson as unknown as TowersFile

export const DATA_VERSION = file.version
export const MAX_LEVEL = 3

/**
 * Balance data is a live binding, not a constant.
 *
 * `export let` rather than `export const` for exactly one caller: the golden
 * fixture, which pins its own frozen copy of these numbers and installs it
 * before replaying. Its whole value depends on that. The fixture is the
 * keystone determinism test, and if it read live data then every one of the
 * hundreds of edits that tuning makes would change its expected hash — so it
 * would get regenerated rather than investigated, and a regression test you
 * regenerate on sight is a rubber stamp. Its doc comment claimed this pinning
 * already happened. It did not; step 8 found that out by changing a number and
 * watching the hash move.
 *
 * Nothing else may write these. See `installBalanceData`.
 */
export let SELL_REFUND = file.sellRefund
/**
 * Ticks between a tower first seeing a creep and its first shot (ADR-0028).
 * A tower that keeps finding targets stays locked on; it waits again only
 * after a tick with nothing in range. Zero is the old rule: fire on sight.
 */
export let ACQUIRE_TICKS = file.acquireTicks
export let ARCHETYPES: readonly TowerArchetype[] = file.archetypes

/** Ordered by TowerKind so `ARCHETYPES[kind]` is always the right one. */
const EXPECTED_KEYS = ['single', 'splash', 'slow']

function assertData(): void {
  if (ARCHETYPES.length !== EXPECTED_KEYS.length) {
    throw new Error(`towers.json: expected ${EXPECTED_KEYS.length} archetypes`)
  }
  for (let k = 0; k < ARCHETYPES.length; k++) {
    const a = ARCHETYPES[k] as TowerArchetype
    if (a.key !== EXPECTED_KEYS[k]) {
      // TowerKind indexes into this array, so order is load-bearing, not
      // cosmetic. A reordered file would silently retarget every tower.
      throw new Error(`towers.json: archetype ${k} must be "${EXPECTED_KEYS[k]}", got "${a.key}"`)
    }
    if (a.levels.length !== MAX_LEVEL) {
      throw new Error(`towers.json: ${a.key} needs exactly ${MAX_LEVEL} levels`)
    }
    for (let l = 1; l < a.levels.length; l++) {
      const prev = a.levels[l - 1] as TowerLevel
      const curr = a.levels[l] as TowerLevel
      // Upgrading must be worth the gold, or the level is dead weight.
      if (curr.cost <= prev.cost) {
        throw new Error(`towers.json: ${a.key} level ${l + 1} must cost more than level ${l}`)
      }
      if (curr.damage <= prev.damage) {
        throw new Error(`towers.json: ${a.key} level ${l + 1} must out-damage level ${l}`)
      }
      if (curr.range < prev.range) {
        throw new Error(`towers.json: ${a.key} level ${l + 1} must not lose range`)
      }
    }
  }
  if (SELL_REFUND <= 0 || SELL_REFUND >= 1) {
    // A refund of 1 or more makes build-and-sell a free action, and a maze you
    // can rebuild for nothing every wave is not a maze.
    throw new Error('towers.json: sellRefund must be between 0 and 1 exclusive')
  }
  assertAcquireTicks(ACQUIRE_TICKS)
}

/** Whole ticks, never negative: it is counted down in an Int32Array. */
function assertAcquireTicks(v: number): number {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error('towers.json: acquireTicks must be a whole number of ticks, zero or more')
  }
  return v
}

assertData()

export function levelOf(kind: TowerKind, level: number): TowerLevel {
  const a = ARCHETYPES[kind] as TowerArchetype
  return a.levels[level - 1] as TowerLevel
}

/** Total gold sunk into a tower at this level, which is what sell refunds from. */
export function investedIn(kind: TowerKind, level: number): number {
  const a = ARCHETYPES[kind] as TowerArchetype
  let total = 0
  for (let l = 0; l < level; l++) total += (a.levels[l] as TowerLevel).cost
  return total
}


// --- creeps -----------------------------------------------------------------

/**
 * Which of the three shapes a creep is, as an index rather than a name.
 *
 * The bot needs to reason about what is coming at it -- a horde wants a
 * different answer than one armoured creep -- and parsing that out of a key
 * like "stone_troll" would be a string comparison in the hot path and a silent
 * breakage the first time something is renamed.
 *
 * Renamed from Swarm / Runner / Tank with the fourteen-creep ladder (ADR-0031).
 * The integers did not move, so a replay frozen with the old roster still
 * reads its creeps' shapes correctly.
 */
export enum CreepArchetypeKind {
  /** Cheapest soak per gold, the thing players mass-send. The mortar answers it. */
  Horde = 0,
  /** Twice a horde's speed, the least HP per gold. The frost shrine answers it. */
  Fast = 1,
  /** Two thirds of a horde's speed, the most HP per gold. The guard tower answers it. */
  Armoured = 2,
}

export interface CreepSpec {
  readonly key: string
  readonly name: string
  /** Which shape this is, for counter-picking on both sides of the board. */
  readonly archetype: CreepArchetypeKind
  /**
   * The creep's rung on the ladder, which is its position in the roster.
   * Tier 0 opens when sending does; tier N, UNLOCK_EVERY_TICKS later each.
   */
  readonly tier: number
  readonly cost: number
  /** How many creeps one purchase releases into the target lane. */
  readonly count: number
  readonly hp: number
  readonly speed: number
  /** Permanent income gain for the SENDER. Never expires. */
  readonly incomeBonus: number
  /** Gold paid to the lane owner for killing one. */
  readonly bounty: number
}

/** One rung of the ladder as `creeps.json` writes it. `tier` is its list position. */
export interface CreepEntry {
  readonly key: string
  readonly name: string
  /** "horde", "fast" or "armoured". */
  readonly shape: string
  readonly cost: number
  readonly count: number
  readonly hp: number
  readonly speed: number
  readonly incomeBonus: number
  readonly bounty: number
}

export interface CreepsFile {
  readonly version: number
  readonly unlockEveryTicks: number
  /** Opening build phase, in ticks. Absent means none. See SEND_UNLOCK_TICKS. */
  readonly sendUnlockTicks?: number
  /** Sudden death, ADR-0026. Absent means never. See SUDDEN_DEATH_TICK. */
  readonly suddenDeathTick?: number
  readonly suddenDeathGrowth?: number
  /** The ladder, cheapest first (ADR-0031). */
  readonly creeps: readonly CreepEntry[]
}

const creepFile = creepsJson as unknown as CreepsFile

/** A shape's key in the file, indexed by CreepArchetypeKind. */
const SHAPE_KEYS = ['horde', 'fast', 'armoured']

function shapeOf(key: string, creep: string): CreepArchetypeKind {
  const i = SHAPE_KEYS.indexOf(key)
  if (i === -1) throw new Error(`creeps.json: "${creep}" has unknown shape "${key}"`)
  return i as CreepArchetypeKind
}

/**
 * Read the ladder into specs.
 *
 * The roster used to be generated here from three archetypes and a growth rule
 * (`base x growth^tier`). ADR-0031 replaced it with a list, because the user's
 * four fixed creeps sit on no clean rule and a rule with per-creep overrides is
 * a list with extra steps. What survives from the old loader is the promise it
 * made: this runs once at load, so the hot path reads a plain array.
 */
export function creepsFromFile(f: CreepsFile): CreepSpec[] {
  return f.creeps.map((c, tier) => ({
    key: c.key,
    name: c.name,
    archetype: shapeOf(c.shape, c.key),
    tier,
    cost: c.cost,
    count: c.count,
    hp: c.hp,
    speed: c.speed,
    incomeBonus: c.incomeBonus,
    bounty: c.bounty,
  }))
}

export let CREEPS: readonly CreepSpec[] = creepsFromFile(creepFile)

/**
 * The loaded creep file, so a tuning tool can vary the ladder in memory
 * rather than by rewriting JSON and reloading the module. Tuning is a search,
 * and a search that costs a process restart per sample is a search nobody runs.
 */
export const CREEP_FILE: CreepsFile = creepFile
export let UNLOCK_EVERY_TICKS = creepFile.unlockEveryTicks

/**
 * The opening build phase: no creep may be sent before this tick.
 *
 * Sending was legal from tick 0, so the first wave could be walking your lane
 * before you had placed a tower. That is not an opening, it is a scramble, and
 * it punished the player who spent two seconds thinking about their maze.
 *
 * It is a balance number and it lives in the balance data, which matters for
 * more than tidiness: the golden fixture pins its own frozen `BalanceData`, and
 * a file recorded before this rule existed carries no `sendUnlockTicks` at all.
 * Defaulting a missing value to 0 is what lets that fixture keep replaying the
 * match it actually recorded, so the keystone determinism test still means what
 * it claims. A rule hardcoded in `step.ts` would have silently rewritten it.
 */
export let SEND_UNLOCK_TICKS = assertSendUnlock(creepFile.sendUnlockTicks ?? 0)

/**
 * Asserted at load, like every other invariant in these files, because the
 * failure is silent and expensive.
 *
 * The income schedule is `(tick - SEND_UNLOCK_TICKS) % INCOME_EVERY_TICKS`. A
 * FRACTIONAL value there is never congruent to zero, so nobody is ever paid
 * again and the whole economy stops -- which reads as catastrophic balance
 * rather than as a typo, and would be chased for an afternoon. A NEGATIVE value
 * shifts the tier ladder before tick 0 and pays the first income early. Neither
 * is a game anybody meant to ship, and both are one keystroke away.
 */
function assertSendUnlock(v: number): number {
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`creeps.json: sendUnlockTicks must be a non-negative integer, got ${v}`)
  }
  return v
}
export const CREEP_DATA_VERSION = creepFile.version

/**
 * Sudden death: the match-ender (ADR-0026, issue #8).
 *
 * From SUDDEN_DEATH_TICK the HP of every creep spawned is multiplied by
 * SUDDEN_DEATH_GROWTH once per income period, compounding, so any maze is
 * eventually walked through -- the guarantee the twenty-tier ladder gave and
 * the three-tier one lost. `suddenDeathScale` is what `step` applies at
 * spawn and what the bot's flood model reads.
 *
 * The factors are a table built by repeated multiplication rather than a
 * `pow`, which is banned in this package (docs/invariants.md), and the table
 * is capped so the heaviest creep's HP still fits the Int32 it is stored in.
 *
 * The cap is derived from the roster (ADR-0031). It was a fixed x100,000,
 * sized for a 6,250-HP Tank III; the ladder's Storm Drake has 2,071,000 HP,
 * and x100,000 of that wraps negative -- which is exactly what the harness
 * `lap` tool had been measuring since it set the tick past sudden death. The
 * derived cap is x1,036 for this ladder, reached 12.25 minutes into sudden
 * death, by which time no maze on this lane is standing. A roster whose cap
 * falls under SUDDEN_DEATH_MIN_CAP fails at load rather than quietly
 * flattening sudden death. NEVER (-1) means the rule is off, which is what a fixture recorded
 * before the rule existed carries.
 */
export const SUDDEN_DEATH_NEVER = -1
export let SUDDEN_DEATH_TICK = assertSuddenDeathTick(creepFile.suddenDeathTick)
export let SUDDEN_DEATH_GROWTH = assertSuddenDeathGrowth(creepFile.suddenDeathGrowth)
/** Largest value an Int32Array slot holds. Creep HP lives in one. */
const INT32_MAX = 2147483647
/** Below this the cap would stop sudden death ending matches, so the roster is refused. */
export const SUDDEN_DEATH_MIN_CAP = 100
const SUDDEN_DEATH_PERIODS = 512
const suddenDeathTable = new Float64Array(SUDDEN_DEATH_PERIODS)
/** The HP multiplier sudden death never exceeds, for the roster currently installed. */
export let SUDDEN_DEATH_MAX_FACTOR = 1
function rebuildSuddenDeath(): void {
  let maxHp = 1
  for (const c of CREEPS) if (c.hp > maxHp) maxHp = c.hp
  SUDDEN_DEATH_MAX_FACTOR = Math.floor(INT32_MAX / maxHp)
  if (SUDDEN_DEATH_MAX_FACTOR < SUDDEN_DEATH_MIN_CAP) {
    throw new Error(
      `creeps.json: the heaviest creep (${maxHp} HP) leaves sudden death a cap of ` +
        `x${SUDDEN_DEATH_MAX_FACTOR}, under the x${SUDDEN_DEATH_MIN_CAP} it needs to end a match`,
    )
  }
  let f = 1
  for (let i = 0; i < SUDDEN_DEATH_PERIODS; i++) {
    f = f * SUDDEN_DEATH_GROWTH
    if (f > SUDDEN_DEATH_MAX_FACTOR) f = SUDDEN_DEATH_MAX_FACTOR
    suddenDeathTable[i] = f
  }
}
rebuildSuddenDeath()

/**
 * The HP multiplier for a creep spawned at `tick`, with income paid every
 * `periodTicks`. 1 before sudden death and whenever the rule is off; the
 * first factor lands on the start tick itself.
 */
export function suddenDeathScale(tick: number, periodTicks: number): number {
  if (SUDDEN_DEATH_TICK === SUDDEN_DEATH_NEVER || tick < SUDDEN_DEATH_TICK) return 1
  let periods = Math.floor((tick - SUDDEN_DEATH_TICK) / periodTicks)
  if (periods >= SUDDEN_DEATH_PERIODS) periods = SUDDEN_DEATH_PERIODS - 1
  return suddenDeathTable[periods] as number
}

function assertSuddenDeathTick(v: number | undefined): number {
  if (v === undefined) return SUDDEN_DEATH_NEVER
  if (!Number.isInteger(v) || v < 0) {
    throw new Error(`creeps.json: suddenDeathTick must be a non-negative integer or absent, got ${v}`)
  }
  return v
}

function assertSuddenDeathGrowth(v: number | undefined): number {
  if (v === undefined) return 1
  if (!Number.isFinite(v) || v < 1) {
    throw new Error(`creeps.json: suddenDeathGrowth must be a finite number of at least 1, got ${v}`)
  }
  return v
}
/**
 * Highest tier the roster reaches: the last rung of the ladder. Follows the
 * installed roster, so a replay frozen with the three-tier roster climbs only
 * the tiers it had.
 */
export let MAX_TIER = CREEPS.length - 1

/**
 * The opening purse and the income it starts on.
 *
 * They live HERE, with the rest of the balance data, rather than beside the
 * state they initialise. They are tuning numbers, and every tuning number has
 * to be freezable or the golden fixture cannot keep the promise it makes in its
 * own comment: that a red hash means the arithmetic diverged and never that
 * somebody edited a balance file. As constants in `state.ts` they were outside
 * the freeze, so the x10 gold rescale moved the fixture's hash while changing no
 * arithmetic whatsoever -- which is exactly the false alarm that teaches people
 * to regenerate the hash without reading it. `state.ts` re-exports both, so
 * every existing import site is unchanged.
 *
 * 9,000 since 2026-09-14, was 6,000: the first retune on the 16-wide lane
 * (issue #48). Ten towers is a wall and a bit on 16 tiles where it was two
 * and a half walls on 8, and the first batch ended two of three templates in a
 * three-minute double knockout with 12 towers standing. Lengthening the build
 * phase was measured first and did nothing -- the income clock anchors to
 * send-unlock (ADR-0009), so a longer opening buys no gold, and every number
 * in the batch shifted by exactly the extra ticks. Fifteen towers is a wall
 * and its plug with change for the second.
 *
 * 1,000 since 2026-09-16, the user's number: a match starts with 100 gold at
 * the x10 scale, and with every level-1 tower at 10 gold that is ten towers.
 * The fifteen-tower finding above was measured against 600-gold towers and the
 * old creep roster, so it is a warning to re-measure, not a rule this breaks:
 * if the opening double-knockout returns, `/balance` says so.
 */
export let STARTING_GOLD = 1000
/**
 * Paid into gold every INCOME_EVERY_TICKS. Sending is the only way it grows.
 *
 * 100 (10 gold a period) since 2026-09-16, chosen by the user in review: one
 * level-1 tower every fifteen seconds before a single send. Was 250 against a
 * 9,000 purse; the new creeps pay 20% of their price as income where the old
 * swarm paid 10%, so sending takes over the economy sooner.
 */
export let STARTING_INCOME = 100

const DEFAULT_STARTING_GOLD = STARTING_GOLD
const DEFAULT_STARTING_INCOME = STARTING_INCOME

/** The balance numbers a replay needs pinned to reproduce a hash. */
export interface BalanceData {
  readonly sellRefund: number
  /** Optional: a fixture recorded before the acquisition delay existed (ADR-0028) has none, meaning fire on sight. */
  readonly acquireTicks?: number
  readonly archetypes: readonly TowerArchetype[]
  readonly unlockEveryTicks: number
  /** Optional: a fixture recorded before the build phase existed has none. */
  readonly sendUnlockTicks?: number
  /** Optional: a fixture recorded before sudden death existed (ADR-0026) has none, meaning never. */
  readonly suddenDeathTick?: number
  readonly suddenDeathGrowth?: number
  /** Optional: a fixture recorded before the opening purse was freezable has none. */
  readonly startingGold?: number
  /** Optional, for the same reason as `startingGold`. */
  readonly startingIncome?: number
  readonly creeps: readonly CreepSpec[]
}

/** Everything currently loaded, for a fixture to freeze. */
export function liveBalanceData(): BalanceData {
  return {
    sellRefund: SELL_REFUND,
    acquireTicks: ACQUIRE_TICKS,
    archetypes: ARCHETYPES,
    unlockEveryTicks: UNLOCK_EVERY_TICKS,
    sendUnlockTicks: SEND_UNLOCK_TICKS,
    suddenDeathTick: SUDDEN_DEATH_TICK === SUDDEN_DEATH_NEVER ? undefined : SUDDEN_DEATH_TICK,
    suddenDeathGrowth: SUDDEN_DEATH_TICK === SUDDEN_DEATH_NEVER ? undefined : SUDDEN_DEATH_GROWTH,
    startingGold: STARTING_GOLD,
    startingIncome: STARTING_INCOME,
    creeps: CREEPS,
  }
}

/**
 * Replace the loaded balance data. **Only the golden fixture may call this.**
 *
 * Returns what was installed before, so a caller can put it back — and a caller
 * that does not put it back has changed the game for every test sharing the
 * module. Always restore in a `finally`.
 */
export function installBalanceData(next: BalanceData): BalanceData {
  const previous = liveBalanceData()
  SELL_REFUND = next.sellRefund
  // Missing means zero: a fixture frozen before the delay existed recorded
  // towers that fired on sight, and replays the match it recorded.
  ACQUIRE_TICKS = assertAcquireTicks(next.acquireTicks ?? 0)
  ARCHETYPES = next.archetypes
  UNLOCK_EVERY_TICKS = next.unlockEveryTicks
  // Missing means none: a fixture frozen before the build phase existed replays
  // the match it recorded, rather than one where half its sends are refused.
  SEND_UNLOCK_TICKS = assertSendUnlock(next.sendUnlockTicks ?? 0)
  // Missing means never: a fixture frozen before sudden death existed
  // recorded a match that had no horizon, and replays the one it recorded.
  SUDDEN_DEATH_TICK = assertSuddenDeathTick(next.suddenDeathTick)
  SUDDEN_DEATH_GROWTH = assertSuddenDeathGrowth(next.suddenDeathGrowth)
  // The roster first: the sudden-death cap is derived from its heaviest creep.
  CREEPS = next.creeps
  MAX_TIER = CREEPS.length - 1
  rebuildSuddenDeath()
  // Missing means today's value, NOT zero: a fixture frozen before these were
  // freezable recorded a match played on the purse of its day, and the numbers
  // it was recorded under are the ones written into its "data" block by hand.
  // Defaulting to zero would replay it with no gold and no income at all.
  STARTING_GOLD = next.startingGold ?? DEFAULT_STARTING_GOLD
  STARTING_INCOME = next.startingIncome ?? DEFAULT_STARTING_INCOME
  return previous
}

/**
 * Tier N becomes buyable at this tick. Tier 0 opens the moment sending does.
 *
 * Anchored to the end of the build phase, for the same reason income is: the
 * ladder is a clock on the CONTEST, and a preamble that runs before anyone may
 * send should not eat into it. Left at tick 0, a 20-second opening delivered
 * tier 1 only ten seconds after first contact instead of thirty, compressing
 * the early game to the point where reading the opponent's maze stopped paying
 * -- measured at 8-4 against the fixed template, from 12-0.
 */
export function tierUnlockTick(tier: number): number {
  return SEND_UNLOCK_TICKS + tier * UNLOCK_EVERY_TICKS
}

export function creepSpec(index: number): CreepSpec {
  return CREEPS[index] as CreepSpec
}

/**
 * Most a whole purchase may refund to the defender, as a share of its cost.
 *
 * Killing a wave should pay for some of the maze that killed it, not most of
 * the wave back.
 */
const MAX_WAVE_BOUNTY_SHARE = 0.35

function assertCreepData(): void {
  if (CREEPS.length === 0) throw new Error('creeps.json: no creeps')

  // The ladder's central economic claim (ADR-0031): each rung costs more than
  // the one below and pays no more income per gold. Buying up is a threat
  // decision and buying down is an economy decision, and this is one character
  // away from being false in a JSON file that gets edited hundreds of times
  // during tuning -- where it would read as badly balanced rather than as buggy.
  // Non-increasing rather than falling: the user's first two creeps tie at 20%.
  // Compared by cross-multiplication, integers only, so no float decides it.
  for (let i = 1; i < CREEPS.length; i++) {
    const below = CREEPS[i - 1] as CreepSpec
    const above = CREEPS[i] as CreepSpec
    if (above.tier !== i) {
      throw new Error(`creeps.json: "${above.key}" is tier ${above.tier} at ladder position ${i}`)
    }
    if (above.cost <= below.cost) {
      throw new Error(`creeps.json: "${above.key}" must cost more than "${below.key}", the rung below it`)
    }
    if (above.incomeBonus * below.cost > below.incomeBonus * above.cost) {
      throw new Error(
        `creeps.json: "${above.key}" pays more income per gold than "${below.key}", the cheaper rung below it`,
      )
    }
  }

  for (const c of CREEPS) {
    if (c.cost <= 0 || c.hp <= 0 || c.count <= 0 || c.speed <= 0) {
      throw new Error(`creeps.json: "${c.key}" has a non-positive cost, hp, count or speed`)
    }
    if (c.incomeBonus <= 0) {
      throw new Error(`creeps.json: "${c.key}" must raise income — sending is the only way income grows`)
    }
    if (c.bounty >= c.cost) {
      // A bounty at or above the send cost would make sending a gift to the
      // defender, which inverts the whole point of sending.
      throw new Error(`creeps.json: "${c.key}" bounty must be below its cost`)
    }
    // The per-creep check above had a hole that step 8 walked straight into: a
    // purchase releases `count` creeps and the defender is paid for every one.
    // The old swarm passed it while handing back 60% of its own cost, and the
    // same shape at a high tier would have handed back 95% -- sending would
    // have been a way to fund your opponent.
    if (c.bounty * c.count > c.cost * MAX_WAVE_BOUNTY_SHARE) {
      throw new Error(
        `creeps.json: "${c.key}" pays back ${c.bounty * c.count}g of its ${c.cost}g cost ` +
          `across ${c.count} kills, over the ${MAX_WAVE_BOUNTY_SHARE * 100}% ceiling`,
      )
    }
  }

  if (UNLOCK_EVERY_TICKS <= 0) throw new Error('creeps.json: unlockEveryTicks must be positive')
}

assertCreepData()
