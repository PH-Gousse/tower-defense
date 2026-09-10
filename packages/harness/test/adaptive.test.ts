import { describe, it, expect } from 'vitest'
import { MatchResult, type BotConfig, type AdaptiveMode, type Reader } from '@ltw/sim'
import { runMatch } from '../src/match'

/**
 * Does reading the board actually help? Measured twice, for two readers, and
 * the two answers disagree -- which is the reason both are pinned.
 *
 * Under the TABLE reader (the original), the design doc's prediction that
 * adaptive *mazing* would matter measured backwards: answering the wave in
 * your lane with the tower that counters it was worse than not looking at
 * all, and the entire gain came from counter-picking what to SEND.
 *
 * Under the ESTIMATE reader (ADR-0016), the defence half is the whole gain:
 * predicting that the flood already in the lane will leak, and spending on
 * whatever stops most of it per gold, beats the template before the first
 * creep laps. That is a different question from the table's -- "what kind of
 * creep is this?" against "will these get through?" -- and the measurements
 * say the second one is the one worth asking.
 *
 * Both are worth a test rather than a commit message, because each is exactly
 * the kind of result someone will later "fix" on reasonable-sounding grounds.
 */

const mk = (sendRatio: number, adaptive: AdaptiveMode, reader: Reader): BotConfig =>
  ({ sendRatio, reactionTicks: 10, template: 0, adaptive, reader })

interface Record {
  readonly wins: number
  readonly losses: number
}

/**
 * Play a variant against the fixed-template bot of the same reader, both
 * seats, several ratios.
 *
 * Memoised, and it yields between matches. Each mode is twelve full matches
 * and several tests want the results, so computing them per test was dozens
 * of matches of tight synchronous loop -- long enough that vitest could not
 * service its own reporter, timed out on `onTaskUpdate`, and failed the run
 * with every assertion passing.
 */
const cache = new Map<string, Promise<Record>>()

function versusTemplate(mode: AdaptiveMode, reader: Reader): Promise<Record> {
  const key = `${reader}:${mode}`
  const existing = cache.get(key)
  if (existing) return existing
  const run = (async (): Promise<Record> => {
    let wins = 0
    let losses = 0
    for (const ratio of [0.25, 0.35, 0.45, 0.55, 0.65, 0.8]) {
      // Both seat orders, so a seat advantage cannot be mistaken for skill.
      for (const first of [true, false]) {
        const bots: [BotConfig, BotConfig] = first
          ? [mk(ratio, mode, reader), mk(ratio, 'off', reader)]
          : [mk(ratio, 'off', reader), mk(ratio, mode, reader)]
        const m = runMatch({ bots, maxTicks: 80000 })
        await new Promise((r) => setTimeout(r, 0))
        if (m.result !== MatchResult.Decided) continue
        if ((m.winner === 0) === first) wins += 1
        else losses += 1
      }
    }
    return { wins, losses }
  })()
  cache.set(key, run)
  return run
}

describe('adaptive play under the table reader', () => {
  it('counter-picking what to send beats the fixed template, clearly', async () => {
    // The whole reason the opponent's board is drawn on your screen.
    const r = await versusTemplate('send', 'table')
    expect(r.wins).toBeGreaterThan(r.losses * 2)
  })

  it('reacting to the wave in your own lane never wins', async () => {
    // Not a neutral change: the fixed 3:1:1 mix answers all three creep shapes
    // adequately, while specialising answers the wave that is already dying --
    // and the bot only ever adds towers, never sells, so every over-commitment
    // is permanent.
    //
    // The MEASUREMENT changed when the spawn queue was removed, and the history
    // is the point. Under the queue, creeps trickled into a lane one every four
    // ticks and `defence` lost 0-12 -- a decisive, useful result. Sends now
    // spawn on the spot, so a wave arrives as a clump and dies as a clump, and
    // the lane composition the bot reads is a far more transient signal: at
    // some spend ratios the defence bot plays a bit-identical match to not
    // looking at all. So the assertion is the surviving half of the claim:
    // reading your own lane THIS WAY is not an improvement.
    const r = await versusTemplate('defence', 'table')
    expect(r.wins).toBe(0)
  })

  it('so send-only beats doing both', async () => {
    const send = await versusTemplate('send', 'table')
    const both = await versusTemplate('both', 'table')
    expect(send.wins).toBeGreaterThanOrEqual(both.wins)
  })
})

describe('adaptive play under the estimate reader', () => {
  it('predicting the flood in your own lane beats not looking, clearly', async () => {
    // The opposite of the table's finding, and the reason `both` ships as the
    // default with the estimate reader. If this ever stops winning, either the
    // targeting or splash rules moved and `threat.ts` needs recalibrating
    // against a streamed flood (see ADR-0016), or the model is wrong; find out
    // which before touching the default.
    const r = await versusTemplate('both', 'estimate')
    expect(r.wins).toBeGreaterThan(r.losses * 2)
  })
})
