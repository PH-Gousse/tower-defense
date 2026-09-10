import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * Argument parsing and output shape, shared by every tool in this directory.
 *
 * Deliberately tiny and dependency-free. These scripts are maintained for the
 * life of the project and read by both CI and the skills, so the priority is
 * that someone can open one and understand it in a minute — not that the
 * argument parser handles every POSIX edge case.
 *
 * Every tool prints a human summary, then a single line of JSON as its LAST
 * line. Callers parse the last line; humans read everything above it. Nothing
 * else may be written to stdout after `emit`.
 */

export type Args = Record<string, string | boolean>

/**
 * `--flag value`, `--flag=value`, and bare `--flag` (which becomes `true`).
 *
 * Unknown flags are kept rather than rejected: a tool that gains an option
 * should not break a caller that passes it to an older build.
 */
export function parseArgs(argv: readonly string[]): Args {
  const out: Args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next
      i++
    } else {
      out[a.slice(2)] = true
    }
  }
  return out
}

export function num(args: Args, key: string, fallback: number): number {
  const v = args[key]
  if (v === undefined || v === true) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) {
    fail(`--${key} expects a number, got "${v}"`)
  }
  return n
}

export function str(args: Args, key: string, fallback: string): string {
  const v = args[key]
  // `true` is a bare flag with no value, `false` cannot occur from parseArgs
  // but the type allows it. Either way there is no string here, so fall back.
  if (typeof v !== 'string') return fallback
  return v
}

export function flag(args: Args, key: string): boolean {
  return args[key] === true || args[key] === 'true'
}

/** Human-readable section header. */
export function say(line = ''): void {
  console.log(line)
}

/**
 * The machine-readable last line, and the process exit code.
 *
 * `ok: false` exits non-zero so CI fails without anyone having to parse
 * anything. The JSON always carries `tool`, `ok` and `summary` so a caller can
 * report a failure it does not otherwise understand.
 */
export function emit(tool: string, ok: boolean, summary: string, data: Record<string, unknown>): never {
  console.log(JSON.stringify({ tool, ok, summary, ...data }))
  process.exit(ok ? 0 : 1)
}

/** An argument or environment problem — not a test failure. Exit code 2. */
export function fail(message: string): never {
  console.error(`error: ${message}`)
  console.log(JSON.stringify({ tool: 'cli', ok: false, summary: message, usageError: true }))
  process.exit(2)
}

/**
 * Resolve a path the way a person typing it expects.
 *
 * These tools are invoked through `pnpm --filter @ltw/harness exec`, so their
 * cwd is `packages/harness`, not the repo root — but every path a person types
 * (and every path in a README) is repo-relative. Without this,
 * `--replay fixtures/replays/short.json` fails with "cannot read", which is a
 * confusing error for a file that is plainly there.
 *
 * Tries: as given, then relative to the repo root. Absolute paths pass through.
 */
export function resolvePath(p: string, repoRoot: string): string {
  if (isAbsolute(p)) return p
  if (existsSync(p)) return resolve(p)
  const fromRoot = join(repoRoot, p)
  if (existsSync(fromRoot)) return fromRoot
  return p // let the caller report a readable "cannot read" against what was typed
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

/** Seconds of game time from a tick count, at the fixed 20Hz. */
export function gameSeconds(ticks: number): number {
  return ticks / 20
}
