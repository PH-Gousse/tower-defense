/**
 * The harness's CLI helper, re-exported so every art tool has the same shape:
 * a human summary, then ONE line of JSON last, `ok:false` exits 1, a usage or
 * environment problem exits 2. One implementation on purpose -- two copies of
 * "print a JSON line last" would drift on exactly the detail CI parses.
 */
export { parseArgs, num, str, flag, say, emit, fail, resolvePath, type Args } from '../../../packages/harness/tools/lib/cli'

import { execFileSync } from 'node:child_process'

/** True when `bin` is on PATH. */
export function have(bin: string): boolean {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${bin}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Every tool checks what it needs before doing anything, and says how to get
 * it. A tool that fails halfway through with ENOENT on `blender` has wasted
 * the caller's time and left half an output behind.
 */
export function requireTools(tools: readonly { bin: string; install: string }[]): void {
  const missing = tools.filter((t) => !have(t.bin))
  if (missing.length === 0) return
  for (const m of missing) console.error(`missing: ${m.bin}    install: ${m.install}`)
  console.log(JSON.stringify({ tool: 'cli', ok: false, summary: `missing tools: ${missing.map((m) => m.bin).join(', ')}`, usageError: true, missing }))
  process.exit(2)
}

/** `<id|all>` positional, or `--changed`; returns the ids to work on. */
export function selectIds(argv: readonly string[], all: () => string[]): string[] {
  const positional = argv.filter((a) => !a.startsWith('--'))
  const target = positional[0]
  if (target === undefined || target === 'all') return all()
  return positional
}
