import { describe, it, expect } from 'vitest'
import { MatchResult, type BotConfig, type AdaptiveMode } from '@ltw/sim'
import { runMatch } from '../src/match'

/**
 * Does reading the board actually help?
 *
 * The design doc predicted that adaptive *mazing* would be the first thing to
 * build after v1 — the bot's templates never respond to what is sent at them.
 * Measurement says the opposite: answering the wave in your lane with the tower
 * that counters it is worse than not looking at all, and the entire gain comes
 * from the other half, counter-picking what to SEND at the opponent's maze.
 *
 * That is worth a test rather than a commit message, because it is exactly the
 * kind of result someone will later "fix" on the reasonable-sounding grounds
 * that a bot which reacts to threats must surely beat one that does not.
 */

const mk = (sendRatio: number, adaptive: AdaptiveMode): BotConfig =>
  ({ sendRatio, reactionTicks: 10, template: 0, adaptive })

interface Record {
  readonly wins: number
  readonly losses: number
}

/**
 * Play a variant against the fixed-template bot, both seats, several ratios.
 *
 * Memoised, and it yields between matches. Each mode is twelve full matches and
 * three tests want the results, so computing them per test was thirty-six
 * matches of tight synchronous loop -- long enough that vitest could not
 * service its own reporter, timed out on `onTaskUpdate`, and failed the run
 * with every assertion passing.
 */
const cache = new Map<AdaptiveMode, Promise<Record>>()

function versusTemplate(mode: AdaptiveMode): Promise<Record> {
  const existing = cache.get(mode)
  if (existing) return existing
  const run = (async (): Promise<Record> => {
    let wins = 0
    let losses = 0
    for (const ratio of [0.25, 0.35, 0.45, 0.55, 0.65, 0.8]) {
      // Both seat orders, so a seat advantage cannot be mistaken for skill.
      for (const first of [true, false]) {
        const bots: [BotConfig, BotConfig] = first
          ? [mk(ratio, mode), mk(ratio, 'off')]
          : [mk(ratio, 'off'), mk(ratio, mode)]
        const m = runMatch({ bots, maxTicks: 80000 })
        await new Promise((r) => setTimeout(r, 0))
        if (m.result !== MatchResult.Decided) continue
        if ((m.winner === 0) === first) wins += 1
        else losses += 1
      }
    }
    return { wins, losses }
  })()
  cache.set(mode, run)
  return run
}

describe('adaptive play', () => {
  it('counter-picking what to send beats the fixed template, clearly', async () => {
    // The whole reason the opponent's board is drawn on your screen.
    const r = await versusTemplate('send')
    expect(r.wins).toBeGreaterThan(r.losses * 2)
  })

  it('reacting to the wave in your own lane never wins', async () => {
    // Not a neutral change: the fixed 3:1:1 mix answers all three creep shapes
    // adequately, while specialising answers the wave that is already dying --
    // and the bot only ever adds towers, never sells, so every over-commitment
    // is permanent. If this ever starts winning, the maze rules changed and the
    // default in `bot.ts` should be revisited.
    //
    // The MEASUREMENT changed when the spawn queue was removed, and the history
    // is the point. Under the queue, creeps trickled into a lane one every four
    // ticks and `defence` lost 0-12 -- a decisive, useful result. Sends now
    // spawn on the spot, so a wave arrives as a clump and dies as a clump, and
    // the lane composition the bot reads is a far more transient signal: at
    // spend ratios 0.25 and 0.55 the defence bot now plays a bit-identical
    // match to not looking at all (same final state hash), and all twelve go to
    // draws. So the assertion is the surviving half of the claim: reading your
    // own lane is not an improvement. It went from harmful to worthless.
    //
    // Nothing ships on this -- DEFAULT_ADAPTIVE is 'send', and 'send' is still
    // 12-0. Why clumping kills the read is genuinely unexplained; if defence
    // mode ever matters again, that is the thing to find out first.
    const r = await versusTemplate('defence')
    expect(r.wins).toBe(0)
  })

  it('so the shipped default is send-only, and it beats doing both', async () => {
    const send = await versusTemplate('send')
    const both = await versusTemplate('both')
    expect(send.wins).toBeGreaterThanOrEqual(both.wins)
  })
})
