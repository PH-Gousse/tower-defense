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
export const SELL_REFUND = file.sellRefund
export const ARCHETYPES: readonly TowerArchetype[] = file.archetypes
export const MAX_LEVEL = 3

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

export interface CreepSpec {
  readonly key: string
  readonly name: string
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

interface CreepsFile {
  readonly version: number
  readonly unlockEveryTicks: number
  readonly creeps: readonly CreepSpec[]
}

const creepFile = creepsJson as unknown as CreepsFile

export const CREEPS: readonly CreepSpec[] = creepFile.creeps
export const UNLOCK_EVERY_TICKS = creepFile.unlockEveryTicks
export const CREEP_DATA_VERSION = creepFile.version

/** Tier N becomes buyable at this tick. Tier 0 is available immediately. */
export function tierUnlockTick(tier: number): number {
  return tier * UNLOCK_EVERY_TICKS
}

export function creepSpec(index: number): CreepSpec {
  return CREEPS[index] as CreepSpec
}

function assertCreepData(): void {
  if (CREEPS.length === 0) throw new Error('creeps.json: no creeps')

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
  }

  if (UNLOCK_EVERY_TICKS <= 0) throw new Error('creeps.json: unlockEveryTicks must be positive')
}

assertCreepData()
