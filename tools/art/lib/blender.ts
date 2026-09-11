import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GENERATORS, SCRIPTS } from './paths'

/**
 * Finding and running Blender and the generator package's Python.
 *
 * Blender is looked up on PATH and at its Homebrew cask location. The
 * generator version comes from the package itself so the build cache key
 * cannot drift from what the code says.
 */

const CANDIDATES = [
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/opt/homebrew/bin/blender',
  '/usr/local/bin/blender',
  'blender',
]

export function findBlender(): string | null {
  for (const c of CANDIDATES) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore', timeout: 20_000 })
      return c
    } catch {
      /* next */
    }
  }
  return null
}

export const BLENDER_INSTALL = 'brew install --cask blender   (Blender 4.2 or newer; 5.2.1 is what the factory was written against)'

export function generatorVersion(): string {
  const src = readFileSync(join(GENERATORS, 'ltw_art', '__init__.py'), 'utf8')
  const m = /GENERATOR_VERSION\s*=\s*"([^"]+)"/.exec(src)
  if (!m) throw new Error('GENERATOR_VERSION not found in art/generators/ltw_art/__init__.py')
  return m[1] as string
}

/**
 * Run a script under art/scripts headlessly. The result JSON is read from a
 * file the script writes (`--result`), not from stdout: Blender's render
 * log writes to the same stdout from C while Python is printing a 75 KB
 * JSON line, and the two interleave (measured: a corrupted line at byte
 * 75299 after a full catalogue render). stdout parsing is the fallback.
 */
export function runBlender(blender: string, script: string, args: string[], timeoutMs = 600_000): { ok: boolean; json: Record<string, unknown> | null; output: string } {
  const path = join(SCRIPTS, script)
  if (!existsSync(path)) throw new Error(`no such script ${path}`)
  const resultFile = join(tmpdir(), `ltw-blender-${process.pid}-${Date.now()}.json`)
  const r = spawnSync(blender, ['--background', '--factory-startup', '--python', path, '--', ...args, '--result', resultFile], {
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = (r.stdout ?? '') + (r.stderr ?? '')
  let json: Record<string, unknown> | null = null
  if (existsSync(resultFile)) {
    try {
      json = JSON.parse(readFileSync(resultFile, 'utf8')) as Record<string, unknown>
    } catch {
      /* fall through to stdout */
    }
    rmSync(resultFile, { force: true })
  }
  const lines = json ? [] : (r.stdout ?? '').trim().split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = (lines[i] ?? '').trim()
    if (l.startsWith('{') && l.endsWith('}')) {
      try {
        json = JSON.parse(l) as Record<string, unknown>
        break
      } catch {
        /* not ours */
      }
    }
  }
  return { ok: r.status === 0 && json?.['ok'] === true, json, output }
}

/** Run the pure half (dry run) with the system python3 -- no Blender. */
export function runDryRun(specFiles: string[]): { ok: boolean; json: Record<string, unknown> | null; output: string } {
  const r = spawnSync('python3', [join(SCRIPTS, 'dry_run.py'), ...specFiles], { encoding: 'utf8', timeout: 120_000 })
  const output = (r.stdout ?? '') + (r.stderr ?? '')
  const last = (r.stdout ?? '').trim().split('\n').pop() ?? ''
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(last) as Record<string, unknown>
  } catch {
    /* no json */
  }
  return { ok: r.status === 0, json, output }
}
