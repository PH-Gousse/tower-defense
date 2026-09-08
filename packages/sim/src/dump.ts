import { CREEP_DATA_VERSION, DATA_VERSION, liveBalanceData, type BalanceData } from './data'
import type { HashEntry } from './desync'
import type { Command } from './step'

/**
 * The desync dump: one JSON file that reproduces a match.
 *
 * Freezing on a mismatch and naming the tick tells you *that* it broke, not
 * *why*. The input log lives in memory and dies with the tab, so without this
 * a desync at a friend's house is unreproducible — the single most expensive
 * class of bug this project can have, and the one the whole determinism
 * apparatus exists to make cheap.
 *
 * This is the only observability in the project. No backend, no telemetry, no
 * logging: what is actually needed is the ability to reproduce one specific
 * failure, and a file you can drag into a headless replay does that.
 */

/** Bump when the shape changes in a way an old replay tool cannot read. */
export const DUMP_VERSION = 2

export interface DesyncDump {
  readonly dumpVersion: number
  /** Build that produced it. Two peers on different builds is a likely cause. */
  readonly build: string
  readonly capturedAt: string
  /** Why the file exists: a real mismatch, or a player pressing the debug key. */
  readonly trigger: 'desync' | 'manual'
  readonly towerDataVersion: number
  readonly creepDataVersion: number
  /**
   * The actual balance numbers, not just their version.
   *
   * Carrying only a version number was tried elsewhere in this codebase and did
   * not work: the golden fixture claimed for six steps to pin its data, did not,
   * and a single creep edit moved its hash. A dump that cannot be replayed after
   * the next tuning pass is a dump that gets thrown away, so the numbers travel
   * with it.
   */
  readonly balance: BalanceData
  /** Seed for the match. Unused today — nothing in the sim draws randomness. */
  readonly seed: number
  /** Negotiated input delay in ticks. 0 in single player. */
  readonly delay: number
  readonly me: 0 | 1
  readonly ticks: number
  /** First tick the two peers disagreed on, or -1 for a manual capture. */
  readonly divergedAtTick: number
  /**
   * Every command from tick 0, in the order the simulation applied them.
   * `None` is never recorded: it is the absence of a command, and writing it
   * down would double the file for no information.
   */
  readonly commands: readonly Command[]
  readonly localHashes: readonly HashEntry[]
  readonly peerHashes: readonly HashEntry[] | null
}

export interface DumpInput {
  readonly build: string
  readonly trigger: 'desync' | 'manual'
  readonly me: 0 | 1
  readonly ticks: number
  readonly commands: readonly Command[]
  readonly localHashes: readonly HashEntry[]
  readonly peerHashes?: readonly HashEntry[] | null
  readonly divergedAtTick?: number
  readonly seed?: number
  readonly delay?: number
  /** Overridden only by tests; defaults to whatever is loaded. */
  readonly balance?: BalanceData
}

export function buildDump(input: DumpInput): DesyncDump {
  return {
    dumpVersion: DUMP_VERSION,
    build: input.build,
    // Wall-clock, for a human reading a folder of these. Nothing in the replay
    // reads it -- the simulation never sees a clock, which is why `Date.now` is
    // banned inside the sim and why this is built out here at the boundary.
    capturedAt: new Date().toISOString(),
    trigger: input.trigger,
    towerDataVersion: DATA_VERSION,
    creepDataVersion: CREEP_DATA_VERSION,
    balance: input.balance ?? liveBalanceData(),
    seed: input.seed ?? 0,
    delay: input.delay ?? 0,
    me: input.me,
    ticks: input.ticks,
    divergedAtTick: input.divergedAtTick ?? -1,
    commands: input.commands,
    localHashes: input.localHashes,
    peerHashes: input.peerHashes ?? null,
  }
}

/** Rejects a file that is not a dump, before a replay wastes time on it. */
export function parseDump(text: string): DesyncDump {
  const raw = JSON.parse(text) as Partial<DesyncDump>
  if (typeof raw.dumpVersion !== 'number') throw new Error('not a desync dump: no dumpVersion')
  if (raw.dumpVersion > DUMP_VERSION) {
    throw new Error(
      `dump version ${raw.dumpVersion} is newer than this build understands (${DUMP_VERSION}) — ` +
        'replay it with the build that produced it',
    )
  }
  if (!Array.isArray(raw.commands)) throw new Error('desync dump has no command log')
  if (!raw.balance) throw new Error('desync dump has no balance data — it cannot be replayed')
  return raw as DesyncDump
}
