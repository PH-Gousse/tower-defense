import { writeFileSync, mkdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { MatchResult, CREEPS } from '@ltw/sim'
import { parseArgs, num, say, emit, pct, gameSeconds } from './lib/cli'
import { REPO_ROOT } from './lib/scan'
import { configFor, SEED_CAVEAT, DISTINCT_CONFIGS } from './lib/config'
import { runRecorded, type RunSummary } from './lib/replay'

/**
 * `balance-batch` — run M matches and report what the economy actually does.
 *
 * Reports win rates, match length distribution, income curves per minute,
 * lap-time distribution, and flags a degenerate strategy when one send pattern
 * wins more than a threshold.
 *
 * Writes a markdown report to reports/balance/<date>.md and prints the path.
 *
 * Honest limits, all three worth knowing before trusting a number here:
 *
 *   1. **Bot-vs-bot measures what the BOT does.** It catches runaway economies
 *      and dominant strategies. It cannot tell you the game is fun, and it
 *      cannot find a strategy the bot does not know how to play.
 *   2. **There are only 9 distinct configurations** (ADR-0010). M=100 is 100
 *      runs of at most 9 different matches. The report says so in its header.
 *   3. **The bot does not sell towers.** Every over-commitment it makes is
 *      permanent, so its economy is more rigid than a human's.
 *
 *   pnpm balance-batch
 *   pnpm balance-batch --matches 18 --max-ticks 40000
 */

const args = parseArgs(process.argv.slice(2))
const matches = num(args, 'matches', 18)
const maxTicks = num(args, 'max-ticks', 40_000)
/** Share of wins by one creep archetype above which we call it degenerate. */
const degenerateThreshold = num(args, 'threshold', 0.7)

say(`balance-batch — ${matches} matches x up to ${maxTicks} ticks`)
say(`  ${SEED_CAVEAT}`)
say()

interface Row {
  readonly seed: number
  readonly config: string
  readonly aiA: string
  readonly aiB: string
  readonly template: string
  readonly summary: RunSummary
}

const rows: Row[] = []
const started = Date.now()

for (let s = 0; s < matches; s++) {
  const config = configFor(s)
  const summary = runRecorded({ bots: config.bots, maxTicks })
  rows.push({
    seed: s,
    config: config.label,
    aiA: config.aiA,
    aiB: config.aiB,
    template: config.templateName,
    summary,
  })
  process.stdout.write(`  ${s + 1}/${matches}\r`)
}
const wallMs = Date.now() - started
say(`  ran ${matches} matches in ${(wallMs / 1000).toFixed(1)}s`)
say()

// --- win rates by preset -----------------------------------------------------

const presetRecord = new Map<string, { wins: number; losses: number; draws: number }>()
function record(name: string): { wins: number; losses: number; draws: number } {
  const r = presetRecord.get(name) ?? { wins: 0, losses: 0, draws: 0 }
  presetRecord.set(name, r)
  return r
}

let decided = 0
let draws = 0
let unfinished = 0

for (const r of rows) {
  const a = record(r.aiA)
  const b = record(r.aiB)
  if (r.summary.result === MatchResult.Playing) {
    unfinished++
    continue
  }
  if (r.summary.result === MatchResult.Draw) {
    draws++
    a.draws++
    b.draws++
    continue
  }
  decided++
  if (r.summary.winner === 0) { a.wins++; b.losses++ } else { b.wins++; a.losses++ }
}

/**
 * Head-to-head, which is the table that actually answers "is the ladder
 * monotone". The aggregate win rate does not: a preset's rate depends on who it
 * happened to be drawn against, so a strong preset drawn against strong
 * opponents can look worse than a weak one drawn against weak ones.
 */
const h2h = new Map<string, { wins: number; losses: number; draws: number }>()
function h2hKey(a: string, b: string): string {
  return `${a} vs ${b}`
}
for (const r of rows) {
  const key = h2hKey(r.aiA, r.aiB)
  const rec = h2h.get(key) ?? { wins: 0, losses: 0, draws: 0 }
  if (r.summary.result === MatchResult.Draw) rec.draws++
  else if (r.summary.result === MatchResult.Decided) {
    if (r.summary.winner === 0) rec.wins++
    else rec.losses++
  }
  h2h.set(key, rec)
}

// --- match length ------------------------------------------------------------

const lengths = rows.map((r) => r.summary.ticks).sort((x, y) => x - y)
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[i] as number
}

// --- lap times ---------------------------------------------------------------

/**
 * Lap time is the gap between consecutive leaks in one match, not the tick a
 * leak happened on. A creep that laps every 15s and one that laps every 90s are
 * completely different pressures, and the raw tick tells you neither.
 */
const lapGaps: number[] = []
for (const r of rows) {
  const t = r.summary.lapTicks
  for (let i = 1; i < t.length; i++) lapGaps.push((t[i] as number) - (t[i - 1] as number))
}
lapGaps.sort((x, y) => x - y)

// --- degenerate strategy -----------------------------------------------------

/**
 * The check: among matches that were decided, what share did the WINNER spend
 * most of its send gold on? If one archetype takes more than the threshold, one
 * send pattern is winning the game and the counter structure is not working.
 */
const winnerFavourite = new Map<string, number>()
for (const r of rows) {
  if (r.summary.result !== MatchResult.Decided) continue
  const w = r.summary.winner
  const by = r.summary.sendsByCreep[w] ?? []
  let bestIdx = -1
  let bestCount = 0
  for (let i = 0; i < by.length; i++) {
    const c = by[i] ?? 0
    if (c > bestCount) { bestCount = c; bestIdx = i }
  }
  if (bestIdx === -1) continue
  const name = CREEPS[bestIdx]?.name ?? `creep ${bestIdx}`
  // Group by archetype, not tier: "Swarm II winning" and "Swarm winning" are
  // the same finding about the same card.
  const archetype = name.replace(/ (II|III|IV|V|VI|VII|VIII|IX|X)$/, '')
  winnerFavourite.set(archetype, (winnerFavourite.get(archetype) ?? 0) + 1)
}

const favouriteTotal = [...winnerFavourite.values()].reduce((a, b) => a + b, 0)
const degenerate: { archetype: string; share: number; wins: number }[] = []
for (const [archetype, wins] of winnerFavourite) {
  const share = favouriteTotal > 0 ? wins / favouriteTotal : 0
  if (share > degenerateThreshold) degenerate.push({ archetype, share, wins })
}

// --- income curves -----------------------------------------------------------

const maxMinutes = Math.max(...rows.map((r) => r.summary.incomeByMinute.length), 0)
const incomeCurve: { minute: number; median: number; samples: number }[] = []
for (let m = 0; m < maxMinutes; m++) {
  const vals: number[] = []
  for (const r of rows) {
    const sample = r.summary.incomeByMinute[m]
    if (sample) { vals.push(sample[0] as number); vals.push(sample[1] as number) }
  }
  vals.sort((a, b) => a - b)
  if (vals.length > 0) {
    incomeCurve.push({ minute: m + 1, median: quantile(vals, 0.5), samples: vals.length })
  }
}

// --- human summary -----------------------------------------------------------

say('  win rate by preset')
for (const name of ['easy', 'normal', 'hard']) {
  const r = presetRecord.get(name)
  if (!r) continue
  const played = r.wins + r.losses + r.draws
  say(`    ${name.padEnd(7)} ${String(r.wins).padStart(3)}W ${String(r.losses).padStart(3)}L ${String(r.draws).padStart(3)}D` +
      `   ${played > 0 ? pct(r.wins / played) : '—'}`)
}
say()
say('  head to head (W-L-D from the first-named seat)')
for (const [key, rec] of h2h) {
  say(`    ${key.padEnd(18)} ${rec.wins}-${rec.losses}-${rec.draws}`)
}
say()
say(`  match length: p10 ${quantile(lengths, 0.1)}t  median ${quantile(lengths, 0.5)}t  p90 ${quantile(lengths, 0.9)}t`)
say(`                (${gameSeconds(quantile(lengths, 0.5)).toFixed(0)}s median game time)`)
say(`  decided ${decided}   draws ${draws}   hit the ceiling ${unfinished}`)
say()
if (lapGaps.length > 0) {
  say(`  lap gap: p10 ${quantile(lapGaps, 0.1)}t  median ${quantile(lapGaps, 0.5)}t  p90 ${quantile(lapGaps, 0.9)}t   (n=${lapGaps.length})`)
} else {
  say(`  lap gap: no leaks in any match`)
}
say(`  peak creeps across all matches: ${Math.max(...rows.map((r) => r.summary.peakCreeps))}`)
say()
if (degenerate.length > 0) {
  say(`  DEGENERATE STRATEGY FLAG (threshold ${pct(degenerateThreshold)})`)
  for (const d of degenerate) {
    say(`    ${d.archetype} was the winner's main send in ${d.wins}/${favouriteTotal} decided matches (${pct(d.share)})`)
  }
} else {
  say(`  no degenerate strategy: no archetype above ${pct(degenerateThreshold)} of winners' main sends`)
}
say()

// --- markdown report ---------------------------------------------------------

const date = new Date().toISOString().slice(0, 10)
const reportDir = join(REPO_ROOT, 'reports/balance')
mkdirSync(reportDir, { recursive: true })
const reportPath = join(reportDir, `${date}.md`)

const md: string[] = []
md.push(`# Balance batch — ${date}`)
md.push('')
md.push(`${matches} matches, up to ${maxTicks} ticks each, ${(wallMs / 1000).toFixed(1)}s wall.`)
md.push('')
md.push('> **Read the limits before the numbers.**')
md.push('>')
md.push(`> - Nothing in the sim consumes a seed (ADR-0010). These ${matches} matches cover at most`)
md.push(`>   **${DISTINCT_CONFIGS} distinct configurations**; the rest are repeats.`)
md.push('> - Bot-vs-bot measures what the *bot* does. It catches runaway economies and dominant')
md.push('>   strategies. It cannot tell you the game is fun, and it cannot find a strategy the bot')
md.push('>   does not know how to play.')
md.push('> - The bot never sells a tower, so every over-commitment it makes is permanent.')
md.push('')
md.push('## Win rate by preset')
md.push('')
md.push('| Preset | W | L | D | Win rate |')
md.push('|---|---|---|---|---|')
for (const name of ['easy', 'normal', 'hard']) {
  const r = presetRecord.get(name)
  if (!r) continue
  const played = r.wins + r.losses + r.draws
  md.push(`| ${name} | ${r.wins} | ${r.losses} | ${r.draws} | ${played > 0 ? pct(r.wins / played) : '—'} |`)
}
md.push('')
md.push('Aggregate win rate depends on who a preset was drawn against, so read the head-to-head')
md.push('table below before concluding anything from it.')
md.push('')
md.push('## Head to head')
md.push('')
md.push('| Matchup | W-L-D (first seat) |')
md.push('|---|---|')
for (const [key, rec] of h2h) md.push(`| ${key} | ${rec.wins}-${rec.losses}-${rec.draws} |`)
md.push('')
md.push('The ladder should be monotone: hard beats normal beats easy, with every mirror a draw.')
md.push('A non-monotone result means `sendRatio` has stopped meaning what it used to, and is the')
md.push('first thing to investigate — it has measured backwards twice before.')
md.push('')
md.push('## Match length')
md.push('')
md.push('| | ticks | game time |')
md.push('|---|---|---|')
for (const [label, q] of [['p10', 0.1], ['median', 0.5], ['p90', 0.9]] as const) {
  const t = quantile(lengths, q)
  md.push(`| ${label} | ${t} | ${gameSeconds(t).toFixed(0)}s |`)
}
md.push('')
md.push(`Decided **${decided}**, draws **${draws}**, hit the tick ceiling **${unfinished}**.`)
if (unfinished > 0) {
  md.push('')
  md.push(`> ${unfinished} match(es) did not end. The bounded creep ladder has no guarantee a match`)
  md.push('> terminates — see issue #8. A rising count here is that gap showing up.')
}
md.push('')
md.push('## Income curve (median across both seats)')
md.push('')
md.push('| Game minute | Median income | Samples |')
md.push('|---|---|---|')
for (const p of incomeCurve) md.push(`| ${p.minute} | ${p.median} | ${p.samples} |`)
md.push('')
md.push('Income only grows by sending, so this curve is a direct read on how much attacking the')
md.push('bots are doing. A flat curve means they are turtling and the economy is not rewarding')
md.push('aggression.')
md.push('')
md.push('## Lap-time distribution')
md.push('')
if (lapGaps.length > 0) {
  md.push('Gap between consecutive leaks, across all matches. This is the pressure a leaked creep')
  md.push('actually applies — the tick a leak lands on tells you nothing on its own.')
  md.push('')
  md.push('| | ticks | seconds |')
  md.push('|---|---|---|')
  for (const [label, q] of [['p10', 0.1], ['median', 0.5], ['p90', 0.9]] as const) {
    const t = quantile(lapGaps, q)
    md.push(`| ${label} | ${t} | ${gameSeconds(t).toFixed(1)}s |`)
  }
  md.push('')
  md.push(`n = ${lapGaps.length} lap gaps.`)
} else {
  md.push('No leaks in any match. Either the mazes are winning outright or nobody is sending.')
}
md.push('')
md.push('## Degenerate strategy check')
md.push('')
md.push(`Threshold: one creep archetype being the winner's main send in more than **${pct(degenerateThreshold)}**`)
md.push('of decided matches.')
md.push('')
if (favouriteTotal === 0) {
  md.push('No decided matches with sends — nothing to check.')
} else {
  md.push("| Archetype | Matches it was the winner's main send | Share |")
  md.push('|---|---|---|')
  for (const [archetype, wins] of [...winnerFavourite].sort((a, b) => b[1] - a[1])) {
    md.push(`| ${archetype} | ${wins} | ${pct(wins / favouriteTotal)} |`)
  }
  md.push('')
  md.push(degenerate.length > 0
    ? `**FLAGGED:** ${degenerate.map((d) => `${d.archetype} at ${pct(d.share)}`).join(', ')}. ` +
      'One send pattern is winning the game, which means the 3x3 counter structure is not working.'
    : '**Clear.** No archetype above the threshold.')
}
md.push('')
md.push('## Per-match detail')
md.push('')
md.push('| Seed | Configuration | Result | Ticks | Peak creeps | P0 income | P1 income |')
md.push('|---|---|---|---|---|---|---|')
for (const r of rows) {
  const res = r.summary.result === MatchResult.Draw ? 'draw'
    : r.summary.result === MatchResult.Playing ? 'ceiling'
    : `p${r.summary.winner}`
  md.push(`| ${r.seed} | ${r.config} | ${res} | ${r.summary.ticks} | ${r.summary.peakCreeps} | ${r.summary.players[0]!.income} | ${r.summary.players[1]!.income} |`)
}
md.push('')
md.push('---')
md.push('')
md.push('Constants are **not** changed on the strength of this report. A proposed change goes')
md.push('through `/rule-change`, which moves the GDD, the constants and the tests together.')
md.push('')

writeFileSync(reportPath, md.join('\n'))

const relPath = relative(REPO_ROOT, reportPath)
say(`  report: ${relPath}`)
say()

emit('balance-batch', true, `${matches} matches, ${degenerate.length} degenerate flag(s)`, {
  matches,
  maxTicks,
  distinctConfigs: DISTINCT_CONFIGS,
  wallMs,
  reportPath: relPath,
  decided,
  draws,
  unfinished,
  winRates: Object.fromEntries([...presetRecord].map(([k, v]) => [k, v])),
  headToHead: Object.fromEntries([...h2h].map(([k, v]) => [k, v])),
  matchLength: { p10: quantile(lengths, 0.1), median: quantile(lengths, 0.5), p90: quantile(lengths, 0.9) },
  lapGap: lapGaps.length > 0
    ? { p10: quantile(lapGaps, 0.1), median: quantile(lapGaps, 0.5), p90: quantile(lapGaps, 0.9), n: lapGaps.length }
    : null,
  peakCreeps: Math.max(...rows.map((r) => r.summary.peakCreeps)),
  incomeCurve,
  degenerate,
  winnerFavourite: Object.fromEntries(winnerFavourite),
})
