import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, flag, say, emit, fail, selectIds } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry } from './lib/spec'
import { RAW, rel } from './lib/paths'
import { findBlender, BLENDER_INSTALL, generatorVersion, runBlender, runDryRun } from './lib/blender'

/**
 * asset-build <id|all> [--force] [--dry-run] [--changed] [--preview]
 *
 * Resolve each spec, hand the resolved JSON to headless Blender, and write
 * assets/raw/<id>.glb plus <id>.build.json. Cached: a raw file whose build
 * log records the same spec hash and generator version is skipped unless
 * --force. `--changed` is the same filter, spelled the way the skills say
 * it; `all` without it also skips what is fresh, so a full rebuild is
 * `all --force`.
 *
 * Every selected spec is built in ONE Blender process. Blender starts in
 * about two seconds and a build takes under one, so one process for the
 * catalogue is the difference between fifteen seconds and a minute.
 *
 * --dry-run runs the pure half under python3: what would be built, no
 * Blender needed, no files written.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const ids = selectIds(argv, listSpecIds)
if (ids.length === 0) fail('no specs selected')

const schema = loadSchema()
const registry = loadRegistry()
const genVersion = generatorVersion()

interface Planned { id: string; hash: string; key: string; specFile: string; reason: string }
const planned: Planned[] = []
const skipped: { id: string; reason: string }[] = []
const invalid: { id: string; problems: string[] }[] = []

const work = join(tmpdir(), `ltw-art-build-${process.pid}`)
mkdirSync(work, { recursive: true })

for (const id of ids) {
  const r = resolveSpec(id, { schema, registry })
  if (r.problems.length) {
    invalid.push({ id, problems: r.problems.map((p) => `${p.path}: ${p.message}`) })
    continue
  }
  const key = `${r.hash}@${genVersion}`
  const logPath = join(RAW, `${id}.build.json`)
  const glbPath = join(RAW, `${id}.glb`)
  let reason = 'no raw build'
  if (existsSync(logPath) && existsSync(glbPath)) {
    try {
      const prev = JSON.parse(readFileSync(logPath, 'utf8')) as { cache_key?: string }
      if (prev.cache_key === key && !flag(args, 'force')) {
        skipped.push({ id, reason: 'fresh' })
        continue
      }
      reason = prev.cache_key === key ? 'forced' : 'spec or generator changed'
    } catch {
      reason = 'unreadable build log'
    }
  }
  const specFile = join(work, `${id}.json`)
  writeFileSync(specFile, JSON.stringify(r.spec, null, 2))
  planned.push({ id, hash: r.hash, key, specFile, reason })
}

for (const s of skipped) say(`fresh    ${s.id}`)
for (const i of invalid) {
  say(`INVALID  ${i.id}`)
  for (const p of i.problems) say(`           ${p}`)
}

if (flag(args, 'dry-run')) {
  const r = runDryRun(planned.map((p) => p.specFile))
  for (const p of planned) say(`dry-run  ${p.id}  (${p.reason})`)
  say(r.output.trim().split('\n').slice(0, -1).join('\n'))
  rmSync(work, { recursive: true, force: true })
  emit('asset-build', r.ok && invalid.length === 0, `${planned.length} spec(s) laid out, nothing written`, { dryRun: true, specs: r.json?.['specs'], skipped, invalid })
}

const results: Record<string, unknown>[] = []
if (planned.length > 0) {
  const blender = findBlender()
  if (!blender) {
    say(`missing: blender    install: ${BLENDER_INSTALL}`)
    emit('asset-build', false, 'blender not found', { missing: ['blender'], usageError: true })
  }
  mkdirSync(RAW, { recursive: true })
  const batch = planned.map((p) => ({
    id: p.id,
    spec: p.specFile,
    out: join(RAW, `${p.id}.glb`),
    log: join(RAW, `${p.id}.build.json`),
    preview: flag(args, 'preview') ? join(RAW, `${p.id}.preview.png`) : null,
    cache_key: p.key,
    spec_hash: p.hash,
  }))
  const batchFile = join(work, 'batch.json')
  writeFileSync(batchFile, JSON.stringify(batch))
  say(`building ${planned.length} spec(s) in one Blender process (${rel(blender)})`)
  const t0 = Date.now()
  const r = runBlender(blender, 'build.py', ['--batch', batchFile])
  const per = (r.json?.['results'] as Record<string, unknown>[] | undefined) ?? []
  for (const p of planned) {
    const row = per.find((x) => x['id'] === p.id)
    if (row && row['ok'] === true) {
      say(`built    ${p.id}  ${String(row['seconds'])}s  (${p.reason})`)
    } else {
      say(`FAILED   ${p.id}  ${row ? String(row['error']) : 'no result from blender'}`)
    }
    results.push(row ?? { id: p.id, ok: false, error: 'no result' })
  }
  if (!r.json) {
    say(r.output.split('\n').slice(-30).join('\n'))
  }
  say(`${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
rmSync(work, { recursive: true, force: true })

const failed = results.filter((x) => x['ok'] !== true)
const ok = failed.length === 0 && invalid.length === 0
emit('asset-build', ok, ok ? `${results.length} built, ${skipped.length} fresh` : `${failed.length} failed, ${invalid.length} invalid`, {
  generatorVersion: genVersion,
  built: results.filter((x) => x['ok'] === true).map((x) => x['id']),
  failed,
  skipped,
  invalid,
})
