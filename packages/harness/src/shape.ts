import { runMatch, type MatchResultSummary } from './match'
import { MatchResult, type BotConfig } from '@ltw/sim'

/**
 * Is this match a contest, or a wait followed by a collapse?
 *
 * Match length alone does not answer it and `decidedFraction` actively misleads
 * on a draw: it is measured against the winner, so a mirror match that ends
 * level reports ~100% "contested" by construction and says nothing at all. The
 * measurement that matters is when lives actually leave the board.
 */
export interface Shape {
  readonly minutes: number
  readonly result: MatchResult
  /** Minute of the first life lost by either side. */
  readonly firstLeakMin: number
  /**
   * Fraction of the match elapsed when the loser was down to half its lives.
   *
   * The headline number. 0.5 means lives drained evenly from start to finish.
   * Near 1.0 means nothing happened and then everything did, which is what a
   * 31-minute match with all 20 lives intact at minute 29 looks like.
   */
  readonly halfwayAt: number
  /** Minutes during which at least one life was lost. */
  readonly activeMinutes: number
  readonly lives: readonly [number, number]
}

export function measureShape(bots: readonly [BotConfig, BotConfig], maxTicks = 80000): Shape {
  const m: MatchResultSummary = runMatch({ bots, maxTicks, sampleEvery: 1200 })
  const samples = m.livesOverTime
  const start = (samples[0]?.[0] as number) ?? 20

  let firstLeak = -1
  let active = 0
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1] as readonly number[]
    const now = samples[i] as readonly number[]
    const lost = before[0]! - now[0]! + (before[1]! - now[1]!)
    if (lost > 0) {
      active += 1
      if (firstLeak === -1) firstLeak = i
    }
  }

  // Track the side that ends lowest; in a draw either will do.
  const loser = (samples.at(-1)?.[0] ?? 0) <= (samples.at(-1)?.[1] ?? 0) ? 0 : 1
  let halfway = samples.length
  for (let i = 0; i < samples.length; i++) {
    if ((samples[i] as readonly number[])[loser]! <= start / 2) {
      halfway = i
      break
    }
  }

  return {
    minutes: m.ticks / 1200,
    result: m.result,
    firstLeakMin: firstLeak,
    halfwayAt: samples.length > 1 ? halfway / (samples.length - 1) : 1,
    activeMinutes: active,
    lives: [m.players[0]!.lives, m.players[1]!.lives],
  }
}
