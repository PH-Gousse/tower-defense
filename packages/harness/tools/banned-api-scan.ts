import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseArgs, flag, str, say, emit, resolvePath } from './lib/cli'
import { scanFiles, scanText, listTs, EXEMPT, REPO_ROOT } from './lib/scan'

/**
 * `banned-api-scan` — the grep half of determinism-check, fast (< 1s).
 *
 * The scanning itself lives in `lib/scan.ts` so the pre-edit hook and
 * determinism-check can call it in-process. This file is only the CLI.
 *
 * Usage:
 *   banned-api-scan                          scan packages/sim/src
 *   banned-api-scan path/a.ts path/b.ts      scan an explicit list
 *   banned-api-scan --quiet                  JSON only
 *
 *   banned-api-scan /tmp/proposed.ts --as packages/sim/src/dump.ts
 *     Scan one file but resolve findings and EXEMPTIONS against a different
 *     path. This is what the pre-edit hook needs: the content it must check is
 *     the PROPOSED content, which does not exist on disk yet, but the exemption
 *     that applies is the one for the file being edited. Without `--as`, an
 *     edit to dump.ts would be scanned as a temp file and lose its ADR-0011
 *     boundary — the hook would block the one file that is allowed to do this.
 */

const args = parseArgs(process.argv.slice(2))
const quiet = flag(args, 'quiet')

const as = str(args, 'as', '')

const explicit = process.argv.slice(2).filter(
  (a, i) => a.endsWith('.ts') && !a.startsWith('--') && process.argv[i + 1] !== undefined,
).filter((a) => a !== as)
const targets =
  explicit.length > 0
    ? explicit.map((p) => resolvePath(p, REPO_ROOT))
    : listTs(join(REPO_ROOT, 'packages/sim/src'))

const all = as
  ? scanText(as, readFileSync(targets[0] as string, 'utf8'))
  : scanFiles(targets)
const violations = all.filter((f) => !f.exempt)
const exempted = all.filter((f) => f.exempt)

if (!quiet) {
  say(`banned-api-scan — ${targets.length} file${targets.length === 1 ? '' : 's'}`)
  say()
  for (const [file, allowed] of Object.entries(EXEMPT)) {
    say(`  declared boundary (ADR-0011): ${file} may use ${allowed.join(', ')}`)
  }
  say()
  if (violations.length === 0) {
    say(`  clean — no banned API found`)
  } else {
    for (const v of violations) {
      say(`  ${v.file}:${v.line}  ${v.rule}`)
      say(`      ${v.text}`)
      say(`      ${v.why}`)
    }
    say()
    say(`  ${violations.length} violation${violations.length === 1 ? '' : 's'}. See docs/invariants.md rule 2.`)
  }
  if (exempted.length > 0) {
    say()
    say(`  ${exempted.length} allowed use${exempted.length === 1 ? '' : 's'} inside the declared boundary:`)
    for (const e of exempted) say(`      ${e.file}:${e.line}  ${e.rule}`)
  }
  say()
}

emit(
  'banned-api-scan',
  violations.length === 0,
  violations.length === 0 ? `clean (${targets.length} files)` : `${violations.length} banned API use(s)`,
  { scanned: targets.length, violations, exempted: exempted.length },
)
