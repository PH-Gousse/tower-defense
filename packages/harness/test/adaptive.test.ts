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

/** Play a variant against the fixed-template bot, both seats, several ratios. */
function versusTemplate(mode: AdaptiveMode): { wins: number; losses: number } {
  let wins = 0
  let losses = 0
  for (const ratio of [0.25, 0.35, 0.45, 0.55, 0.65, 0.8]) {
    // Both seat orders, so a seat advantage cannot be mistaken for skill.
    for (const first of [true, false]) {
      const bots: [BotConfig, BotConfig] = first
        ? [mk(ratio, mode), mk(ratio, 'off')]
        : [mk(ratio, 'off'), mk(ratio, mode)]
      const m = runMatch({ bots, maxTicks: 80000 })
      if (m.result !== MatchResult.Decided) continue
      if ((m.winner === 0) === first) wins += 1
      else losses += 1
    }
  }
  return { wins, losses }
}

describe('adaptive play', () => {
  it('counter-picking what to send beats the fixed template, clearly', () => {
    // The whole reason the opponent's board is drawn on your screen.
    const r = versusTemplate('send')
    expect(r.wins).toBeGreaterThan(r.losses * 2)
  })

  it('reacting to the wave in your own lane is WORSE than not looking', () => {
    // Not a neutral change: the fixed 3:1:1 mix answers all three creep shapes
    // adequately, while specialising answers the wave that is already dying --
    // and the bot only ever adds towers, never sells, so every over-commitment
    // is permanent. If this ever starts winning, the maze rules changed and the
    // default in `bot.ts` should be revisited.
    const r = versusTemplate('defence')
    expect(r.wins).toBeLessThan(r.losses)
  })

  it('so the shipped default is send-only, and it beats doing both', () => {
    const send = versusTemplate('send')
    const both = versusTemplate('both')
    expect(send.wins).toBeGreaterThanOrEqual(both.wins)
  })
})
