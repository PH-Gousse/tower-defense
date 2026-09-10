import { join } from 'node:path'
import { parseArgs, num, flag, say, emit } from './lib/cli'
import { scanFiles, listTs, EXEMPT, REPO_ROOT } from './lib/scan'
import { configFor, SEED_CAVEAT, DISTINCT_CONFIGS } from './lib/config'
import { runRecorded } from './lib/replay'

/**
 * `determinism-check` — the guard that has to be green before sim work is done.
 *
 * Two halves, both required:
 *
 *   1. **Replay halves.** For N configurations, run the same match TWICE from
 *      scratch and compare the state hash at EVERY tick, not just at the end.
 *      Comparing only final hashes finds the same bugs a tick later and tells
 *      you nothing about where; comparing every tick names the exact tick that
 *      parted, which is the difference between a bug report and a bisect.
 *
 *   2. **Banned API scan** over packages/sim, via the same library the pre-edit
 *      hook uses. A run that passes the replay half and fails the scan is still
 *      a failure: the arithmetic happens to agree on THIS engine today.
 *
 * Budget: under 10s for N=20. Both halves run from one process so the sim is
 * parsed once.
 *
 * What this does NOT prove: cross-engine agreement. Two runs in one process
 * share a libm. `scripts/golden-jsc.ts` under bun is what covers that, and CI
 * runs it. Never treat a green run here as the whole story.
 *
 *   pnpm determinism-check
 *   pnpm determinism-check --seeds 20 --max-ticks 3000
 */

const args = parseArgs(process.argv.slice(2))
const seeds = num(args, 'seeds', 20)
/**
 * 5000 rather than 2000, and the reason is worth keeping.
 *
 * At 2000 ticks every bot preset plays identically: both seats are gold-
 * constrained and spend everything, so `sendRatio` has nothing to ration and
 * all nine configurations produce three distinct matches between them. The
 * check passed, and it was checking a third of what it claimed.
 *
 * The presets part at roughly tick 3500. 5000 gives six distinct matches out
 * of nine and still fits the budget. `distinctFinals` below reports the real
 * number so this can never quietly regress again.
 */
const maxTicks = num(args, 'max-ticks', 5000)
const skipScan = flag(args, 'no-scan')

say(`determinism-check — ${seeds} configurations x ${maxTicks} ticks, run twice each`)
say(`  ${SEED_CAVEAT}`)
if (seeds > DISTINCT_CONFIGS) {
  say(`  ${seeds} seeds cover ${DISTINCT_CONFIGS} distinct configurations; the rest repeat.`)
}
say()

interface Mismatch {
  readonly seed: number
  readonly config: string
  readonly tick: number
  readonly first: string
  readonly second: string
}

const mismatches: Mismatch[] = []
const finals = new Map<string, number[]>()
const started = Date.now()

for (let s = 0; s < seeds; s++) {
  const config = configFor(s)
  const a = runRecorded({ bots: config.bots, maxTicks, trace: true })
  const b = runRecorded({ bots: config.bots, maxTicks, trace: true })

  let parted = -1
  const n = Math.min(a.hashes.length, b.hashes.length)
  for (let t = 0; t < n; t++) {
    if (a.hashes[t] !== b.hashes[t]) {
      parted = t
      break
    }
  }

  if (parted === -1 && a.hashes.length !== b.hashes.length) {
    // Same hashes as far as both went, but one ran longer: the match ended on
    // different ticks, which is a divergence in the result rather than in state.
    parted = n
  }

  if (parted !== -1) {
    mismatches.push({
      seed: s,
      config: config.label,
      tick: parted + 1,
      first: a.hashes[parted] ?? '(ended)',
      second: b.hashes[parted] ?? '(ended)',
    })
    say(`  FAIL seed ${s} (${config.label}) — parted at tick ${parted + 1}`)
  } else {
    say(`  ok   seed ${s} (${config.label}) — ${a.hashes.length} ticks identical, final ${a.hash}`)
  }
  {
    const seen = finals.get(a.hash) ?? []
    seen.push(s)
    finals.set(a.hash, seen)
  }
}

const replayMs = Date.now() - started

/**
 * How many of those runs were actually different matches.
 *
 * A seed selects a configuration, but two configurations can still play out
 * identically — and at short tick counts most of them do. Reporting the count
 * of distinct final hashes is what stops a green run overstating its coverage.
 */
const distinctFinals = finals.size
say()
say(`  ${seeds} runs produced ${distinctFinals} distinct final state${distinctFinals === 1 ? '' : 's'}.`)
if (distinctFinals < Math.min(seeds, DISTINCT_CONFIGS)) {
  say(`  Fewer than the ${Math.min(seeds, DISTINCT_CONFIGS)} configurations available — some play identically`)
  say(`  at ${maxTicks} ticks. Raise --max-ticks to separate them.`)
  for (const [hash, group] of finals) {
    if (group.length > 1) say(`    seeds ${group.join(', ')} all end at ${hash}`)
  }
}

// --- the scan half -----------------------------------------------------------

let violations: ReturnType<typeof scanFiles> = []
let exempted = 0
let scanned = 0
let scanMs = 0

if (!skipScan) {
  const scanStart = Date.now()
  const targets = listTs(join(REPO_ROOT, 'packages/sim/src'))
  const all = scanFiles(targets)
  violations = all.filter((f) => !f.exempt)
  exempted = all.filter((f) => f.exempt).length
  scanned = targets.length
  scanMs = Date.now() - scanStart

  say()
  say(`  banned-API scan — ${scanned} files in packages/sim/src (${scanMs}ms)`)
  for (const [file, allowed] of Object.entries(EXEMPT)) {
    say(`    declared boundary (ADR-0011): ${file} may use ${allowed.join(', ')}`)
  }
  if (violations.length === 0) {
    say(`    clean (${exempted} allowed use${exempted === 1 ? '' : 's'} inside the boundary)`)
  } else {
    for (const v of violations) {
      say(`    ${v.file}:${v.line}  ${v.rule}`)
      say(`        ${v.text}`)
      say(`        ${v.why}`)
    }
  }
}

const totalMs = Date.now() - started
const ok = mismatches.length === 0 && violations.length === 0

say()
if (ok) {
  say(`  PASS — ${seeds} configurations reproduced tick for tick, no banned API. ${totalMs}ms`)
} else {
  say(`  FAIL — ${mismatches.length} divergence(s), ${violations.length} banned API use(s). ${totalMs}ms`)
  if (mismatches.length > 0) {
    say()
    say('  A divergence between two runs in ONE process is one of four things:')
    say('    - hidden state: a module-level `let` that survives between runs')
    say('    - iteration order: a Map/Set/Object walked instead of an indexed array')
    say('    - a banned API that the scan missed (report it — the scan is the bug)')
    say('    - a float trap: -0 vs 0, or NaN, reaching the hash')
    say('  Start at the named tick and diff the two states field by field.')
    say('  Never "fix" this by loosening the comparison.')
  }
}
say()

emit('determinism-check', ok, ok ? `${seeds} configs identical, scan clean` : `${mismatches.length} divergence(s), ${violations.length} banned API`, {
  seeds,
  maxTicks,
  distinctConfigs: DISTINCT_CONFIGS,
  distinctFinals,
  replayMs,
  scanMs,
  totalMs,
  mismatches,
  scanned,
  violations,
  exempted,
  crossEngineNote: 'this proves nothing about cross-engine agreement — see scripts/golden-jsc.ts',
})
