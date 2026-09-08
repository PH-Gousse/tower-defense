import {
  MatchResult,
  BOT_NORMAL,
  installBalanceData,
  liveBalanceData,
  TICK_HZ,
  type BotConfig,
  type AdaptiveMode,
} from '@ltw/sim'
import { runMatch } from './match'

/**
 * What the opening build phase does to the rest of the game.
 *
 * `pnpm --filter @ltw/harness opening`
 *
 * The build phase looks like a UI nicety and is not. Sending is the only way
 * income grows, so a preamble during which nobody may send changes when the
 * economy starts compounding — and anything else on a clock that still counts
 * from tick 0 quietly loses that time.
 *
 * The measurement that matters is the bot's counter-picking advantage over the
 * fixed-template bot, because it is the finding the shipped `adaptive: 'send'`
 * default rests on. Adding a 20-second opening inverted it from 12-0 to 4-8,
 * and it was a cliff rather than a slope: the edge vanished at exactly the
 * length where the first send stopped preceding the first income payout.
 *
 *   income anchored at tick 0, ladder at tick 0   ->  4-8   (cliff at ~290)
 *   income anchored to the unlock                 ->  8-4
 *   income AND tier ladder anchored to the unlock -> 12-0   at every length
 *
 * So both clocks now start when the contest does. This script is what says so,
 * and re-running it is how to check that a change to the opening, the income
 * cadence or the unlock cadence has not quietly undone it.
 */

const RATIOS = [0.25, 0.35, 0.45, 0.55, 0.65, 0.8]
const LENGTHS = [0, 200, 280, 300, 400, 600, 900]

const mk = (sendRatio: number, adaptive: AdaptiveMode): BotConfig => ({
  ...BOT_NORMAL,
  sendRatio,
  adaptive,
})

interface Record {
  wins: number
  losses: number
  undecided: number
}

/** `mode` against the fixed template, over every ratio and both seat orders. */
function versusTemplate(mode: AdaptiveMode): Record {
  let wins = 0
  let losses = 0
  let undecided = 0
  for (const ratio of RATIOS) {
    // Both seat orders, so a seat advantage cannot be mistaken for skill.
    for (const first of [true, false]) {
      const bots: [BotConfig, BotConfig] = first
        ? [mk(ratio, mode), mk(ratio, 'off')]
        : [mk(ratio, 'off'), mk(ratio, mode)]
      const m = runMatch({ bots, maxTicks: 80_000 })
      if (m.result !== MatchResult.Decided) {
        undecided += 1
        continue
      }
      if ((m.winner === 0) === first) wins += 1
      else losses += 1
    }
  }
  return { wins, losses, undecided }
}

const base = liveBalanceData()
console.log('Counter-picking vs the fixed template, by opening length.')
console.log('The claim under test is wins > losses * 2 — see test/adaptive.test.ts.\n')
console.log('ticks   opening   W-L      undecided   holds?')
try {
  for (const ticks of LENGTHS) {
    installBalanceData({ ...base, sendUnlockTicks: ticks })
    const r = versusTemplate('send')
    const holds = r.wins > r.losses * 2
    console.log(
      `${String(ticks).padEnd(8)}${`${ticks / TICK_HZ}s`.padEnd(10)}` +
        `${`${r.wins}-${r.losses}`.padEnd(9)}${String(r.undecided).padEnd(12)}${holds ? 'yes' : 'NO'}`,
    )
  }
} finally {
  // Restoring matters even on a throw: the module state is shared.
  installBalanceData(base)
}
