import {
  createState,
  step,
  botCommand,
  hashHex,
  MatchResult,
  Kind,
  BOT_NORMAL,
  type BotConfig,
  type Command,
  type GameState,
} from '@ltw/sim'

/**
 * Run one bot-vs-bot match, headless.
 *
 * This exists because tuning is the longest pole in the project and hand-tuning
 * a real-time game one match at a time is unbounded work. Two decisions already
 * paid for it: `step()` is pure and resettable, and the bot emits commands like
 * a player, so a complete match needs no human and no browser.
 *
 * What it deliberately does NOT do: sweeps, batch runs, aggregate reporting.
 * Those are the full harness and stay out of v1. This answers "is this economy
 * degenerate", not "what are the right numbers".
 *
 * Honest limit: bot-vs-bot measures what the *bot* does. It catches runaway
 * economies and dominant strategies; it cannot tell you the game is fun.
 */

export interface MatchResultSummary {
  readonly winner: number
  readonly result: MatchResult
  readonly ticks: number
  readonly hash: string
  readonly players: readonly {
    readonly lives: number
    readonly gold: number
    readonly income: number
    readonly kills: number
    readonly leaks: number
  }[]
  readonly peakCreeps: number
  readonly sends: readonly number[]
  /**
   * The tick after which the eventual loser was never again level with the
   * winner on lives.
   *
   * This is the Open Q4 metric, and it has one flaw worth knowing before
   * trusting it: it is measured against the WINNER, so a draw has no loser to
   * track and reports ~100% "contested" by construction. Every mirror match is
   * a draw. It once reported 98-100% for matches in which nothing whatsoever
   * happened for twenty-nine of thirty-one minutes. Read `measureShape` for the
   * question this was meant to answer -- when lives actually leave the board.
   *
   * Lives only fall, so "never regains a life" is trivially true and useless;
   * what matters is when the gap stopped closing.
   * A low `decidedFraction` means most of the match was a formality, which is
   * the exact failure mode an uncapped-HP-versus-capped-DPS race produces.
   */
  readonly decidedAtTick: number
  readonly decidedFraction: number
  /** Lives for each player, sampled every `sampleEvery` ticks. */
  readonly livesOverTime: readonly (readonly number[])[]
}

export interface MatchOptions {
  readonly bots?: readonly [BotConfig, BotConfig]
  readonly maxTicks?: number
  readonly sampleEvery?: number
}

export function runMatch(options: MatchOptions = {}): MatchResultSummary {
  const bots = options.bots ?? [BOT_NORMAL, BOT_NORMAL]
  const maxTicks = options.maxTicks ?? 40_000
  const sampleEvery = options.sampleEvery ?? 200

  let a: GameState = createState()
  let b: GameState = createState()

  let peakCreeps = 0
  const sends = [0, 0]
  const livesOverTime: number[][] = []
  // Tracks the last tick at which the two players were level or the eventual
  // loser was ahead. Resolved into decidedAtTick once we know who lost.
  let lastLevelTick = 0

  let ticks = 0
  for (let t = 0; t < maxTicks; t++) {
    const commands: Command[] = []
    for (const p of [0, 1] as const) {
      for (const cmd of botCommand(a, p, bots[p] as BotConfig)) {
        commands.push(cmd)
        // Counted per command, which is per creep now that a purchase is one
        // creep. A decision that buys a wave is several sends, not one.
        if (cmd.kind === Kind.Send) sends[p] = (sends[p] as number) + 1
      }
    }

    const out = step(a, commands, b)
    b = a
    a = out
    ticks = a.tick

    const l0 = a.players[0]!.lives
    const l1 = a.players[1]!.lives
    if (l0 === l1) lastLevelTick = a.tick

    let live = 0
    for (const lane of a.lanes) live += lane.creeps.count
    if (live > peakCreeps) peakCreeps = live

    if (a.tick % sampleEvery === 0) livesOverTime.push([l0, l1])

    if (a.result !== MatchResult.Playing) break
  }

  // If the eventual loser was ever AHEAD after the last level point, the match
  // was still genuinely contested past it — so walk forward from lastLevelTick
  // using the samples we kept.
  const loser = a.winner === -1 ? -1 : a.winner === 0 ? 1 : 0
  let decidedAtTick = lastLevelTick
  if (loser !== -1) {
    for (let i = 0; i < livesOverTime.length; i++) {
      const sample = livesOverTime[i] as number[]
      const loserLives = sample[loser] as number
      const winnerLives = sample[1 - loser] as number
      if (loserLives >= winnerLives) decidedAtTick = (i + 1) * sampleEvery
    }
  }

  return {
    winner: a.winner,
    result: a.result,
    ticks,
    hash: hashHex(a),
    players: [0, 1].map((p) => ({
      lives: a.players[p]!.lives,
      gold: a.players[p]!.gold,
      income: a.players[p]!.income,
      kills: a.players[p]!.kills,
      leaks: a.players[p]!.leaks,
    })),
    peakCreeps,
    sends,
    decidedAtTick,
    decidedFraction: ticks > 0 ? decidedAtTick / ticks : 0,
    livesOverTime,
  }
}
