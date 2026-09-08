import { MatchResult, BOT_EASY, BOT_NORMAL, BOT_HARD, type BotConfig } from '@ltw/sim'
import { runMatch } from './match'

/**
 * CLI: run one bot-vs-bot match and print what happened.
 *
 *   pnpm --filter @ltw/harness start            normal vs normal
 *   pnpm --filter @ltw/harness start easy hard  a mismatch
 *
 * The numbers to actually read are at the bottom: peak creep population
 * (the render budget, Open Q2) and the decided fraction (Open Q4 — how much
 * of the match was a formality).
 */

const PRESETS: Record<string, BotConfig> = { easy: BOT_EASY, normal: BOT_NORMAL, hard: BOT_HARD }

function preset(name: string | undefined, fallback: BotConfig): BotConfig {
  if (!name) return fallback
  const found = PRESETS[name]
  if (!found) {
    console.error(`unknown bot "${name}". Options: ${Object.keys(PRESETS).join(', ')}`)
    process.exit(1)
  }
  return found
}

const [, , p0 = 'normal', p1 = 'normal'] = process.argv
const bots: [BotConfig, BotConfig] = [preset(p0, BOT_NORMAL), preset(p1, BOT_NORMAL)]

const started = Date.now()
const m = runMatch({ bots })
const elapsed = Date.now() - started

const outcome =
  m.result === MatchResult.Draw
    ? 'draw'
    : m.result === MatchResult.Playing
      ? `no result (hit the tick ceiling)`
      : `player ${m.winner} wins`

const secs = (m.ticks / 20).toFixed(0)

console.log(`\n${p0} vs ${p1} — ${outcome}`)
console.log(`${m.ticks} ticks (${secs}s of game time) simulated in ${elapsed}ms`)
console.log(`hash ${m.hash}\n`)

console.log('            lives   gold  income  kills  leaks  sends')
for (let p = 0; p < 2; p++) {
  const s = m.players[p]!
  console.log(
    `  player ${p}  ` +
      `${String(s.lives).padStart(5)}  ` +
      `${String(s.gold).padStart(5)}  ` +
      `${String(s.income).padStart(6)}  ` +
      `${String(s.kills).padStart(5)}  ` +
      `${String(s.leaks).padStart(5)}  ` +
      `${String(m.sends[p]).padStart(5)}`,
  )
}

console.log(`\npeak creeps on the field: ${m.peakCreeps}   (budget: 500, Open Q2)`)

if (m.result === MatchResult.Decided) {
  const pct = (m.decidedFraction * 100).toFixed(0)
  console.log(
    `decided after ${m.decidedAtTick} ticks — ${pct}% of the match was still contested` +
      (m.decidedFraction < 0.5
        ? `\n  ^ under half. That is the Open Q4 concern: a long known-lost tail.`
        : ''),
  )
}

// A compact lives graph. Reading the shape matters more than the numbers: a
// gap that opens early and never closes is the failure mode to watch for.
console.log('\nlives over time (p0 / p1)')
const step = Math.max(1, Math.ceil(m.livesOverTime.length / 20))
for (let i = 0; i < m.livesOverTime.length; i += step) {
  const [a, b] = m.livesOverTime[i] as number[]
  const bar = (n: number) => '#'.repeat(Math.max(0, Math.round((n as number) / 2))).padEnd(10)
  console.log(`  ${String(i * 200).padStart(6)}  ${bar(a!)} ${String(a).padStart(2)} | ${String(b).padStart(2)} ${bar(b!)}`)
}
console.log()
