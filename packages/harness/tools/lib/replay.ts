import {
  createState,
  step,
  hashHex,
  botCommand,
  installBalanceData,
  liveBalanceData,
  Kind,
  MatchResult,
  TowerKind,
  type BalanceData,
  type BotConfig,
  type Command,
  type GameState,
} from '@ltw/sim'

/**
 * The replay file format, and the two things that produce and consume one.
 *
 * A replay is `{ seed, commandLog }` plus the frozen balance data it ran under
 * (ADR-0003). The balance data is not optional and was an expensive lesson:
 * tuning is hundreds of edits to creeps.json and towers.json, and every one
 * changes the final hash of every recorded match. A replay that reads LIVE data
 * gets regenerated rather than investigated, which turns the keystone
 * regression test into a rubber stamp.
 *
 * The on-disk shape is deliberately a SUPERSET of the existing golden fixtures
 * in packages/sim/test/golden/, so `replay-verify` reads both with one loader
 * and there is exactly one replay format in the project rather than two.
 * `seed` and `config` are the fields this format adds; the golden fixtures
 * simply lack them.
 */

/** Commands are stored by name, not by enum ordinal — an ordinal that shifts
 * would silently reinterpret every stored replay. */
export interface ReplayCommand {
  readonly at: number
  readonly player: 0 | 1
  readonly kind: 'build' | 'upgrade' | 'sell' | 'send'
  readonly tower?: number
  readonly creep?: number
  readonly x?: number
  readonly y?: number
}

export interface ReplayFile {
  readonly _comment?: string
  /** Reserved. Nothing consumes it yet — see ADR-0010. */
  readonly seed?: number
  readonly config?: string
  readonly ticks: number
  readonly commands: readonly ReplayCommand[]
  readonly expectedHash: string
  /** The balance numbers this hash was recorded under. Never optional. */
  readonly data: BalanceData
}

export function toCommand(c: ReplayCommand): Command {
  switch (c.kind) {
    case 'build':
      return {
        tick: c.at,
        player: c.player,
        kind: Kind.Build,
        tower: (c.tower ?? 0) as TowerKind,
        x: c.x ?? 0,
        y: c.y ?? 0,
      }
    case 'upgrade':
      return { tick: c.at, player: c.player, kind: Kind.Upgrade, x: c.x ?? 0, y: c.y ?? 0 }
    case 'sell':
      return { tick: c.at, player: c.player, kind: Kind.Sell, x: c.x ?? 0, y: c.y ?? 0 }
    case 'send':
      return { tick: c.at, player: c.player, kind: Kind.Send, creep: c.creep ?? 0 }
  }
}

export function fromCommand(c: Command): ReplayCommand | null {
  switch (c.kind) {
    case Kind.Build:
      return { at: c.tick, player: c.player, kind: 'build', tower: c.tower, x: c.x, y: c.y }
    case Kind.Upgrade:
      return { at: c.tick, player: c.player, kind: 'upgrade', x: c.x, y: c.y }
    case Kind.Sell:
      return { at: c.tick, player: c.player, kind: 'sell', x: c.x, y: c.y }
    case Kind.Send:
      return { at: c.tick, player: c.player, kind: 'send', creep: c.creep }
    default:
      return null
  }
}

export interface RunSummary {
  readonly ticks: number
  readonly result: MatchResult
  readonly winner: number
  readonly hash: string
  readonly peakCreeps: number
  readonly players: readonly {
    readonly lives: number
    readonly gold: number
    readonly income: number
    readonly kills: number
    readonly leaks: number
    readonly sends: number
  }[]
  /** Income per player, sampled once a game-minute. */
  readonly incomeByMinute: readonly (readonly number[])[]
  /** Every lap completed, as the tick it completed on. One entry per leak. */
  readonly lapTicks: readonly number[]
  /** Sends per creep index, per player. Feeds the degenerate-strategy check. */
  readonly sendsByCreep: readonly (readonly number[])[]
  readonly commands: readonly ReplayCommand[]
  /** Hash after every tick. Only collected when asked — it is the expensive bit. */
  readonly hashes: readonly string[]
}

export interface RunOptions {
  readonly bots: readonly [BotConfig, BotConfig]
  readonly maxTicks: number
  /** Collect a per-tick hash trail. Off by default; determinism-check turns it on. */
  readonly trace?: boolean
  /** Record the command log. Off by default; headless-match turns it on. */
  readonly record?: boolean
}

/**
 * Run one match and report everything the tools need.
 *
 * This deliberately does NOT reuse `src/match.ts`. That function answers "is
 * this economy degenerate" and discards the command log; these tools need the
 * log, the per-tick hash trail, and per-creep send counts. Rather than grow one
 * function two sets of callers pull in opposite directions, the tools own this
 * one and `runMatch` stays what it is.
 */
export function runRecorded(options: RunOptions): RunSummary {
  const { bots, maxTicks } = options
  const trace = options.trace ?? false
  const record = options.record ?? false

  let a: GameState = createState()
  let b: GameState = createState()

  const recorded: ReplayCommand[] = []
  const hashes: string[] = []
  const sends = [0, 0]
  const sendsByCreep: number[][] = [[], []]
  const incomeByMinute: number[][] = []
  const lapTicks: number[] = []
  let peakCreeps = 0
  const lastLeaks = [0, 0]

  for (let t = 0; t < maxTicks; t++) {
    const commands: Command[] = []
    for (const p of [0, 1] as const) {
      for (const cmd of botCommand(a, p, bots[p] as BotConfig)) {
        commands.push(cmd)
        if (cmd.kind === Kind.Send) {
          sends[p] = (sends[p] as number) + 1
          const by = sendsByCreep[p] as number[]
          by[cmd.creep] = (by[cmd.creep] ?? 0) + 1
        }
        if (record) {
          const rc = fromCommand(cmd)
          if (rc) recorded.push(rc)
        }
      }
    }

    const out = step(a, commands, b)
    b = a
    a = out

    if (trace) hashes.push(hashHex(a))

    let live = 0
    for (const lane of a.lanes) live += lane.creeps.count
    if (live > peakCreeps) peakCreeps = live

    // A leak IS a completed lap, so the leak counters are the lap clock.
    for (let p = 0; p < 2; p++) {
      const now = a.players[p]!.leaks
      for (let n = lastLeaks[p] as number; n < now; n++) lapTicks.push(a.tick)
      lastLeaks[p] = now
    }

    // 1200 ticks = one game-minute at 20Hz.
    if (a.tick % 1200 === 0) incomeByMinute.push([a.players[0]!.income, a.players[1]!.income])

    if (a.result !== MatchResult.Playing) break
  }

  return {
    ticks: a.tick,
    result: a.result,
    winner: a.winner,
    hash: hashHex(a),
    peakCreeps,
    players: [0, 1].map((p) => ({
      lives: a.players[p]!.lives,
      gold: a.players[p]!.gold,
      income: a.players[p]!.income,
      kills: a.players[p]!.kills,
      leaks: a.players[p]!.leaks,
      sends: sends[p] as number,
    })),
    incomeByMinute,
    lapTicks,
    sendsByCreep,
    commands: recorded,
    hashes,
  }
}

/**
 * Re-simulate a stored replay and return the hash it reaches.
 *
 * Installs the replay's own frozen balance data for the length of the run and
 * puts the live data back whatever happens. Skipping the restore would silently
 * retune everything else in the process.
 */
export function replayToHash(file: ReplayFile): { hash: string; ticks: number } {
  const byTick = new Map<number, Command[]>()
  for (const c of file.commands) {
    const list = byTick.get(c.at) ?? []
    list.push(toCommand(c))
    byTick.set(c.at, list)
  }

  const previous = installBalanceData(file.data)
  try {
    let a: GameState = createState()
    let b: GameState = createState()
    for (let t = 0; t < file.ticks; t++) {
      const out = step(a, byTick.get(t) ?? [], b)
      b = a
      a = out
    }
    return { hash: hashHex(a), ticks: a.tick }
  } finally {
    installBalanceData(previous)
  }
}

export function currentBalance(): BalanceData {
  return liveBalanceData()
}
