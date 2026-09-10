import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The banned-API scan: the grep half of determinism-check, fast.
 *
 * The CLI wrapper is `tools/banned-api-scan.ts`; this is the library so the
 * hook, determinism-check and the tests can all call `scanFiles` without a
 * process boundary.
 *
 * Budget: under a second. It is run by the pre-edit hook on every write to
 * `packages/sim`, so it has to be quicker than the person typing. That rules
 * out parsing: this is a regex scan over source text, and it is deliberately
 * the crude half of the pair. The golden fixture running on two engines is what
 * actually PROVES determinism; this catches the mistake before it is committed.
 *
 * It is stricter than eslint on purpose. `no-restricted-properties` matches
 * property access, so `new Date()` slips past a ban on `Date.now`, and `JSON`
 * is not restricted at all. Both matter here and neither is caught by the lint
 * config, which is why this exists rather than shelling out to eslint.
 *
 * Usage:
 *   banned-api-scan                             scan packages/sim/src
 *   banned-api-scan --files a.ts b.ts           scan a specific list (the hook)
 *   banned-api-scan --stdin-file path/to/x.ts   scan stdin as if it were that path
 */

/**
 * The declared exemption, and the only one. See ADR-0011.
 *
 * `dump.ts` serialises desync dumps: it needs a wall-clock stamp for a human
 * reading a folder of them, and JSON to read one back. It is never on the
 * `step()` path and no replay reads its timestamp.
 *
 * The exemption is printed on every run rather than applied in silence. A
 * scanner with an invisible exception is worse than no scanner — someone would
 * eventually add code to this file believing it was covered.
 */
export const EXEMPT: Readonly<Record<string, readonly string[]>> = {
  'packages/sim/src/dump.ts': ['Date', 'JSON'],
}

interface Rule {
  readonly id: string
  readonly re: RegExp
  readonly why: string
}

const RULES: readonly Rule[] = [
  { id: 'Math.random', re: /\bMath\s*\.\s*random\s*\(/, why: 'unseeded randomness. Take a seeded generator as a parameter.' },
  {
    id: 'Math.transcendental',
    re: /\bMath\s*\.\s*(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|sinh|cosh|tanh|hypot|cbrt|expm1|log1p|fround)\s*\(/,
    why: 'not bit-exact across engines — each platform ships its own libm. Allowed: sqrt, floor, ceil, round, abs, min, max, trunc, sign, imul.',
  },
  { id: 'exponent-operator', re: /\*\*(?!\/)/, why: 'the ** operator is Math.pow spelled differently. Multiply repeatedly.' },
  { id: 'Date', re: /\bnew\s+Date\s*\(|\bDate\s*\.\s*now\s*\(/, why: 'the sim reads no clock. The driver owns the accumulator and passes ticks in.' },
  { id: 'performance.now', re: /\bperformance\s*\.\s*now\s*\(/, why: 'the sim reads no clock.' },
  { id: 'timers', re: /\b(setTimeout|setInterval|requestAnimationFrame|queueMicrotask)\s*\(/, why: 'the sim does not schedule. It advances only through step().' },
  { id: 'async', re: /\basync\s+(function|\(|[A-Za-z_$])|\bawait\s+/, why: 'the sim is synchronous. An await is a place two machines can diverge in ordering.' },
  { id: 'Promise', re: /\bPromise\s*[.<(]/, why: 'the sim is synchronous.' },
  { id: 'crypto', re: /\bcrypto\s*\./, why: 'unseeded randomness, and unavailable in some runtimes.' },
  { id: 'toFixed', re: /\.toFixed\s*\(/, why: 'locale- and precision-dependent. Fine for display, never for logic.' },
  { id: 'JSON', re: /\bJSON\s*\.\s*(parse|stringify)\s*\(/, why: 'key order is not guaranteed, so JSON round-trips are not a stable identity.' },
  { id: 'unordered-iteration', re: /\bObject\s*\.\s*(keys|values|entries)\s*\(/, why: 'unordered iteration. Use an array or typed array with an explicit order.' },
  { id: 'for-in', re: /\bfor\s*\(\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s+in\s+/, why: 'for...in order is not guaranteed. Use an indexed loop.' },
  { id: 'sort-no-comparator', re: /\.sort\s*\(\s*\)/, why: 'Array.sort without a comparator coerces to string. Pass an explicit comparator.' },
  { id: 'Math-alias', re: /(const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*Math\s*[;\n]/, why: 'aliasing Math defeats the property scan. Write Math.foo(...) literally.' },
]

export interface Finding {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly text: string
  readonly why: string
  readonly exempt: boolean
}

/**
 * Strip comments and string literals before matching.
 *
 * Without this the scan fires on every doc comment that NAMES a banned API —
 * and this codebase's comments name them constantly, because they explain why
 * each one is banned. `rng.ts` alone would produce a false positive that
 * teaches everyone to ignore the tool.
 *
 * Replacing with spaces rather than deleting keeps column and line numbers
 * honest.
 */
export function stripNonCode(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i] as string
    const next = src[i + 1]

    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && next === '*') {
      out += '  '; i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      out += '  '; i += 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '; i++
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') { out += '  '; i += 2; continue }
        out += src[i] === '\n' ? '\n' : ' '
        i++
      }
      out += ' '; i++
      continue
    }
    out += c
    i++
  }
  return out
}

export function scanText(repoRelPath: string, src: string): Finding[] {
  const exemptions = EXEMPT[repoRelPath] ?? []
  const codeLines = stripNonCode(src).split('\n')
  const rawLines = src.split('\n')
  const found: Finding[] = []

  for (let l = 0; l < codeLines.length; l++) {
    const code = codeLines[l] as string
    if (code.trim() === '') continue
    for (const rule of RULES) {
      if (!rule.re.test(code)) continue
      const family = rule.id.split('.')[0] as string
      const exempt = exemptions.includes(rule.id) || exemptions.includes(family)
      found.push({
        file: repoRelPath,
        line: l + 1,
        rule: rule.id,
        text: (rawLines[l] as string).trim(),
        why: rule.why,
        exempt,
      })
    }
  }
  return found
}

export function listTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      out.push(...listTs(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * The repo root, found by walking up for `pnpm-workspace.yaml`.
 *
 * Counting `..` from this file's location is what this used to do, and it was
 * wrong by one level and silently scanned nothing. Looking for the marker
 * survives the file being moved.
 */
function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let up = 0; up < 10; up++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('cannot find the repo root (no pnpm-workspace.yaml above this file)')
}

export const REPO_ROOT = findRepoRoot()

export function scanFiles(paths: readonly string[]): Finding[] {
  const found: Finding[] = []
  for (const p of paths) {
    const rel = relative(REPO_ROOT, resolve(p)).split('\\').join('/')
    let src: string
    try {
      src = readFileSync(p, 'utf8')
    } catch {
      continue
    }
    found.push(...scanText(rel, src))
  }
  return found
}
