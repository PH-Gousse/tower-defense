import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { MatchResult } from '@ltw/sim'
import { parseArgs, num, str, say, emit, gameSeconds } from './lib/cli'
import { configFor, SEED_CAVEAT, PRESET_NAMES } from './lib/config'
import { runRecorded, currentBalance, type ReplayFile } from './lib/replay'

/**
 * `headless-match` — run one match with no rendering, and optionally record it.
 *
 * Uses the real sim (`step`) and the real AI opponent (`botCommand`). Nothing
 * here is a mock or a stand-in: if this match diverges from what the client
 * would do, the client is wrong or this is, and either way it is a real bug.
 *
 *   pnpm headless-match --seed 3
 *   pnpm headless-match --seed 3 --ai-a hard --ai-b easy --max-ticks 20000
 *   pnpm headless-match --seed 0 --out fixtures/replays/short.json
 *
 * On `--seed`: nothing in the sim consumes one (ADR-0010). It selects a
 * configuration — a maze template and a pair of bot presets — and the run
 * prints which. Do not read "20 seeds" as "20 independent samples".
 */

const args = parseArgs(process.argv.slice(2))
const seed = num(args, 'seed', 0)
const aiA = str(args, 'ai-a', '')
const aiB = str(args, 'ai-b', '')
const maxTicks = num(args, 'max-ticks', 40_000)
const out = str(args, 'out', '')

const config = configFor(seed, aiA || undefined, aiB || undefined)

say(`headless-match — seed ${seed}`)
say(`  ${config.label}`)
say(`  ai-a=${config.aiA}  ai-b=${config.aiB}  template=${config.template} ("${config.templateName}")`)
say(`  max-ticks=${maxTicks}`)
say(`  presets available: ${PRESET_NAMES.join(', ')}`)
say(`  ${SEED_CAVEAT}`)
say()

const started = Date.now()
const m = runRecorded({ bots: config.bots, maxTicks, record: out !== '' })
const wallMs = Date.now() - started

const outcome =
  m.result === MatchResult.Draw
    ? 'draw'
    : m.result === MatchResult.Playing
      ? 'no result — hit the tick ceiling'
      : `player ${m.winner} wins`

say(`  ${outcome}`)
say(`  ${m.ticks} ticks (${gameSeconds(m.ticks).toFixed(0)}s of game time) in ${wallMs}ms wall`)
say(`  final hash ${m.hash}`)
say()
say('            lives    gold  income  kills  leaks  sends')
for (let p = 0; p < 2; p++) {
  const s = m.players[p]!
  say(
    `  player ${p}  ` +
      `${String(s.lives).padStart(5)}  ` +
      `${String(s.gold).padStart(6)}  ` +
      `${String(s.income).padStart(6)}  ` +
      `${String(s.kills).padStart(5)}  ` +
      `${String(s.leaks).padStart(5)}  ` +
      `${String(s.sends).padStart(5)}`,
  )
}
say()
say(`  peak creeps on the field: ${m.peakCreeps}`)
say(`  laps completed: ${m.lapTicks.length}`)

if (out) {
  const file: ReplayFile = {
    _comment:
      `Recorded by headless-match. seed ${seed} selects "${config.label}" — nothing in the ` +
      `sim consumes a seed, see ADR-0010. Re-verify with: pnpm replay-verify`,
    seed,
    config: config.label,
    ticks: m.ticks,
    commands: m.commands,
    expectedHash: m.hash,
    data: currentBalance(),
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n')
  say()
  say(`  wrote ${out}  (${m.commands.length} commands, expected hash ${m.hash})`)
}
say()

emit('headless-match', true, `${outcome}, ${m.ticks} ticks`, {
  seed,
  config: config.label,
  aiA: config.aiA,
  aiB: config.aiB,
  template: config.template,
  ticks: m.ticks,
  gameSeconds: gameSeconds(m.ticks),
  wallMs,
  result: MatchResult[m.result],
  winner: m.winner,
  hash: m.hash,
  peakCreeps: m.peakCreeps,
  laps: m.lapTicks.length,
  players: m.players,
  out: out || null,
  commandsRecorded: out ? m.commands.length : 0,
})
