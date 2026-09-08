import {
  createState,
  step,
  hashState,
  installBalanceData,
  findDivergence,
  parseDump,
  MatchResult,
  type Command,
  type DesyncDump,
  type GameState,
  type HashEntry,
} from '@ltw/sim'

/**
 * Replay a desync dump headlessly.
 *
 * This is the payoff for hashing every tick and logging every command: a
 * desync at a friend's house becomes a local, repeatable run. It answers the
 * question that actually matters, which is not "did it break" but **which side
 * was wrong** — replay the log here and compare against both peers' recorded
 * hashes. Whoever this machine agrees with was right; whoever it parts from,
 * and the tick it parts at, is where to look.
 */

export interface ReplayResult {
  readonly ticks: number
  readonly result: MatchResult
  readonly hashes: readonly HashEntry[]
  /** Comparison against the client that produced the dump. */
  readonly vsLocal: ReturnType<typeof findDivergence>
  /** Comparison against its peer, when the dump carries peer hashes. */
  readonly vsPeer: ReturnType<typeof findDivergence> | null
}

export function replayDump(dump: DesyncDump): ReplayResult {
  const byTick = new Map<number, Command[]>()
  for (const c of dump.commands) {
    const list = byTick.get(c.tick) ?? []
    list.push(c)
    byTick.set(c.tick, list)
  }

  // The dump's own balance numbers, not whatever this checkout happens to have.
  // Replaying a months-old dump against today's creeps.json would diverge for a
  // reason that has nothing to do with the bug.
  const previous = installBalanceData(dump.balance)
  try {
    let a: GameState = createState()
    let b: GameState = createState()
    const hashes: HashEntry[] = []
    for (let t = 0; t < dump.ticks; t++) {
      const out = step(a, byTick.get(t) ?? [], b)
      b = a
      a = out
      hashes.push({ tick: a.tick, hash: hashState(a) >>> 0 })
    }
    return {
      ticks: a.tick,
      result: a.result,
      hashes,
      vsLocal: findDivergence(hashes, dump.localHashes),
      vsPeer: dump.peerHashes ? findDivergence(hashes, dump.peerHashes) : null,
    }
  } finally {
    installBalanceData(previous)
  }
}

export function replayFile(text: string): { dump: DesyncDump; result: ReplayResult } {
  const dump = parseDump(text)
  return { dump, result: replayDump(dump) }
}
