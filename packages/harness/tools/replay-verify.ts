import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseArgs, str, say, emit } from './lib/cli'
import { REPO_ROOT } from './lib/scan'
import { replayToHash, type ReplayFile } from './lib/replay'

/**
 * `replay-verify` — re-simulate every stored replay and compare final hashes.
 *
 * This is the regression test that a rule change cannot slip past. Every replay
 * carries the balance data it was recorded under, so a red result here means
 * the SIMULATION changed, not that somebody edited a number — that separation
 * is the whole reason the format freezes its data (ADR-0003).
 *
 * It verifies two directories:
 *   fixtures/replays/            recorded by headless-match, bot-vs-bot
 *   packages/sim/test/golden/    the hand-built keystone fixtures
 *
 * Both because they catch different things. The golden fixtures play a rounded
 * match by hand and reach cases a bot never plays; the recorded ones are long
 * and messy and reach cases nobody would think to write.
 *
 *   pnpm replay-verify
 *   pnpm replay-verify --dir fixtures/replays
 */

const args = parseArgs(process.argv.slice(2))
const only = str(args, 'dir', '')

const DIRS: readonly string[] = only
  ? [only]
  : ['fixtures/replays', 'packages/sim/test/golden']

interface Result {
  readonly path: string
  readonly ok: boolean
  readonly expected: string
  readonly actual: string
  readonly ticks: number
  readonly commands: number
  readonly ms: number
  readonly error?: string
}

function listReplays(dir: string): string[] {
  const full = join(REPO_ROOT, dir)
  if (!existsSync(full)) return []
  return readdirSync(full)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => join(full, f))
}

const results: Result[] = []

for (const dir of DIRS) {
  const files = listReplays(dir)
  for (const path of files) {
    const rel = relative(REPO_ROOT, path)
    let file: ReplayFile
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ReplayFile
    } catch (e) {
      results.push({ path: rel, ok: false, expected: '', actual: '', ticks: 0, commands: 0, ms: 0, error: `unreadable: ${String(e)}` })
      continue
    }

    if (!file.data) {
      // Not pedantry: a replay without frozen balance data verifies against
      // whatever numbers happen to be checked out today, which means it passes
      // for the wrong reason and fails for the wrong reason.
      results.push({
        path: rel, ok: false, expected: file.expectedHash ?? '', actual: '', ticks: file.ticks ?? 0, commands: 0, ms: 0,
        error: 'no frozen balance data — cannot be verified (ADR-0003)',
      })
      continue
    }

    const started = Date.now()
    try {
      const { hash, ticks } = replayToHash(file)
      results.push({
        path: rel,
        ok: hash === file.expectedHash,
        expected: file.expectedHash,
        actual: hash,
        ticks,
        commands: file.commands.length,
        ms: Date.now() - started,
      })
    } catch (e) {
      results.push({
        path: rel, ok: false, expected: file.expectedHash, actual: '', ticks: file.ticks, commands: file.commands.length,
        ms: Date.now() - started, error: String(e),
      })
    }
  }
}

const broken = results.filter((r) => !r.ok)

say(`replay-verify — ${results.length} replay${results.length === 1 ? '' : 's'} in ${DIRS.join(', ')}`)
say()
for (const r of results) {
  const mark = r.ok ? 'ok  ' : 'FAIL'
  say(`  ${mark} ${r.path}`)
  say(`       ${r.ticks} ticks, ${r.commands} commands, ${r.ms}ms`)
  if (!r.ok) {
    if (r.error) say(`       ${r.error}`)
    else say(`       expected ${r.expected}, got ${r.actual}`)
  }
}
say()

if (results.length === 0) {
  say('  no replays found. Record some with:')
  say('    pnpm headless-match --seed 0 --max-ticks 3000 --out fixtures/replays/short.json')
} else if (broken.length === 0) {
  say(`  all ${results.length} reproduce their stored hash bit for bit`)
} else {
  say(`  ${broken.length} of ${results.length} broke:`)
  for (const b of broken) say(`      ${b.path}`)
  say()
  say('  A break is one of two things, and they are not the same:')
  say('    - a BALANCE change: impossible here. Each replay pins its own numbers.')
  say('    - a RULE or ARITHMETIC change: the sim now does something different.')
  say('  If the rule change was intended, regenerate through /rule-change and say why.')
  say('  If it was not, you have found a real regression. Do not regenerate.')
}
say()

emit('replay-verify', broken.length === 0 && results.length > 0, `${results.length - broken.length}/${results.length} verified`, {
  dirs: DIRS,
  total: results.length,
  passed: results.length - broken.length,
  failed: broken.length,
  results,
})
