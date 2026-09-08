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
 * The bot needs to reason about what is coming at it -- a wave of swarm wants a
 * different answer than one tank -- and parsing that out of a key like
 * "swarm3" would be a string comparison in the hot path and a silent breakage
 * the first time something is renamed.
 */
export enum CreepArchetypeKind {
  Swarm = 0,
  Runner = 1,
  Tank = 2,
}

export interface CreepSpec {
  readonly key: string
  readonly name: string
  /** Which shape this is, for counter-picking on both sides of the board. */
  readonly archetype: CreepArchetypeKind
  /** Tier 0 is available from tick 0; tier N unlocks at N * UNLOCK_EVERY_TICKS. */
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

/** The tier-0 stats of one archetype. Every higher tier is derived from these. */
export interface CreepArchetype {
  readonly key: string
  readonly name: string
  readonly cost: number
  readonly count: number
  readonly hp: number
  readonly speed: number
  readonly incomeBonus: number
  readonly bounty: number
}

export interface CreepGrowth {
  readonly cost: number
  readonly hp: number
  readonly income: number
  readonly bounty: number
}

export interface CreepsFile {
  readonly version: number
  readonly unlockEveryTicks: number
  readonly maxTier: number
  readonly growth: CreepGrowth
  readonly archetypes: readonly CreepArchetype[]
}

const creepFile = creepsJson as unknown as CreepsFile

/** File order is the archetype order, and the loader asserts it below. */
const CREEP_ARCHETYPE_KEYS = ['swarm', 'runner', 'tank']

function archetypeOf(key: string): CreepArchetypeKind {
  const i = CREEP_ARCHETYPE_KEYS.indexOf(key)
  if (i === -1) throw new Error(`creeps.json: unknown archetype "${key}"`)
  return i as CreepArchetypeKind
}

/** Tier suffixes. Past this the tier number is spelled out. */
const TIER_SUFFIX = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X']

/**
 * Expand the growth rule into a roster.
 *
 * Done once at load, so the hot path still reads a plain array and nothing
 * downstream has to know the roster is generated. Growth is applied by repeated
 * multiplication rather than by `Math.pow`, which is banned: pow is a libm call
 * and libm differs between engines in the last bits, while a loop of `*` is
 * exact IEEE everywhere. That is not pedantry — these numbers reach the
 * simulation, and two players whose creeps have different HP have desynced.
 */
export function expandCreeps(f: CreepsFile): CreepSpec[] {
  const out: CreepSpec[] = []
  for (let tier = 0; tier <= f.maxTier; tier++) {
    for (const a of f.archetypes) {
      let cost = a.cost
      let hp = a.hp
      let income = a.incomeBonus
      let bounty = a.bounty
      for (let t = 0; t < tier; t++) {
        cost = cost * f.growth.cost
        hp = hp * f.growth.hp
        income = income * f.growth.income
        bounty = bounty * f.growth.bounty
      }
      const suffix = TIER_SUFFIX[tier] ?? ` T${tier + 1}`
      out.push({
        key: tier === 0 ? a.key : `${a.key}${tier + 1}`,
        name: `${a.name}${suffix}`,
        archetype: archetypeOf(a.key),
        tier,
        cost: Math.round(cost),
        count: a.count,
        hp: Math.round(hp),
        speed: a.speed,
        incomeBonus: Math.max(1, Math.round(income)),
        bounty: Math.max(1, Math.round(bounty)),
      })
    }
  }
  return out
}

export let CREEPS: readonly CreepSpec[] = expandCreeps(creepFile)

/**
 * The loaded creep file, so a tuning tool can vary the growth rule in memory
 * rather than by rewriting JSON and reloading the module. Tuning is a search,
 * and a search that costs a process restart per sample is a search nobody runs.
 */
export const CREEP_FILE: CreepsFile = creepFile
export let UNLOCK_EVERY_TICKS = creepFile.unlockEveryTicks
export const CREEP_DATA_VERSION = creepFile.version
/** Highest tier the roster reaches. Tier N unlocks N minutes in. */
export const MAX_TIER = creepFile.maxTier

/** The balance numbers a replay needs pinned to reproduce a hash. */
export interface BalanceData {
  readonly sellRefund: number
  readonly archetypes: readonly TowerArchetype[]
  readonly unlockEveryTicks: number
  readonly creeps: readonly CreepSpec[]
}

/** Everything currently loaded, for a fixture to freeze. */
export function liveBalanceData(): BalanceData {
  return {
    sellRefund: SELL_REFUND,
    archetypes: ARCHETYPES,
    unlockEveryTicks: UNLOCK_EVERY_TICKS,
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
  ARCHETYPES = next.archetypes
  UNLOCK_EVERY_TICKS = next.unlockEveryTicks
  CREEPS = next.creeps
  return previous
}

/** Tier N becomes buyable at this tick. Tier 0 is available immediately. */
export function tierUnlockTick(tier: number): number {
  return tier * UNLOCK_EVERY_TICKS
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

  // Archetype order is load-bearing: the counter-pick tables in bot.ts index by
  // it, so a reordered file would silently make the bot answer swarms with the
  // anti-tank tower and lose matches for a reason nobody would think to look for.
  for (let i = 0; i < CREEP_ARCHETYPE_KEYS.length; i++) {
    const a = creepFile.archetypes[i]
    if (!a || a.key !== CREEP_ARCHETYPE_KEYS[i]) {
      throw new Error(
        `creeps.json: archetype ${i} must be "${CREEP_ARCHETYPE_KEYS[i]}", got "${a?.key}"`,
      )
    }
  }

  // Tiers must be non-descending so the roster reads in unlock order, and so a
  // UI listing them in file order never shows a locked creep above an open one.
  for (let i = 1; i < CREEPS.length; i++) {
    if ((CREEPS[i] as CreepSpec).tier < (CREEPS[i - 1] as CreepSpec).tier) {
      throw new Error('creeps.json: creeps must be ordered by non-descending tier')
    }
  }

  // The design's central economic claim: cheaper creeps give more income per
  // gold, so buying up is a threat decision and buying down is an economy
  // decision. This is one character away from being false in a JSON file that
  // gets edited hundreds of times during tuning, and if it broke the game would
  // read as badly balanced rather than as buggy.
  const byTier = new Map<number, CreepSpec[]>()
  for (const c of CREEPS) {
    const list = byTier.get(c.tier) ?? []
    list.push(c)
    byTier.set(c.tier, list)
  }
  for (const [tier, list] of byTier) {
    const sorted = list.slice().sort((a, b) => a.cost - b.cost)
    for (let i = 1; i < sorted.length; i++) {
      const cheap = sorted[i - 1] as CreepSpec
      const dear = sorted[i] as CreepSpec
      if (cheap.incomeBonus / cheap.cost <= dear.incomeBonus / dear.cost) {
        throw new Error(
          `creeps.json: tier ${tier}: "${cheap.key}" is cheaper than "${dear.key}" but does not give more income per gold`,
        )
      }
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
