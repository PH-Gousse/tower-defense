import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, flag, say, emit, have } from './lib/cli'
import { listSpecIds } from './lib/spec'
import { REPORTS, rel } from './lib/paths'

/**
 * asset-regen [--all | --changed]
 *
 * Rebuild after a generator or style-sheet change and report which assets
 * CHANGED VISUALLY, so the impact can be reviewed rather than trusted:
 *
 *   1. asset-build   (--all forces every spec; --changed, the default, only
 *                     what the cache says is stale)
 *   2. asset-gate    for what was rebuilt
 *   3. asset-preview for what was rebuilt, with the previous previews kept
 *      aside and compared pixel by pixel (ImageMagick AE metric)
 *
 * Output: per asset, rebuilt or not, admitted or rejected, and the fraction
 * of turntable pixels that changed. A "changed" asset is one whose
 * turntable differs by more than 0.5% of pixels; the before/after strips are
 * left in reports/art/<id>/regen/ for the eye.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const all = flag(args, 'all')
const tool = (name: string, a: string[]) => {
  const r = spawnSync('npx', ['vite-node', `${name}.ts`, ...a], { cwd: import.meta.dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const last = (r.stdout ?? '').trim().split('\n').pop() ?? '{}'
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(last) as Record<string, unknown> } catch { /* tool crashed */ }
  return { ok: r.status === 0, json, out: r.stdout ?? '' }
}

// Keep the current previews aside before anything is rebuilt.
const before = join(REPORTS, '.regen-before')
rmSync(before, { recursive: true, force: true })
mkdirSync(before, { recursive: true })
for (const id of listSpecIds()) {
  const tt = join(REPORTS, id, 'turntable.png')
  if (existsSync(tt)) cpSync(tt, join(before, `${id}.png`))
}

const build = tool('asset-build', ['all', ...(all ? ['--force'] : [])])
const rebuilt = ((build.json['built'] as string[] | undefined) ?? [])
say(`rebuilt ${rebuilt.length}: ${rebuilt.join(', ') || 'nothing'}`)
if (rebuilt.length === 0) {
  rmSync(before, { recursive: true, force: true })
  emit('asset-regen', build.ok, 'nothing stale; nothing rebuilt', { rebuilt: [], changed: [], unchanged: [], rejected: [] })
}
const gate = tool('asset-gate', rebuilt)
const rejected = ((gate.json['rejected'] as { id: string }[] | undefined) ?? []).map((r) => r.id)
const admitted = rebuilt.filter((id) => !rejected.includes(id))
for (const id of rejected) say(`REJECTED ${id}  (see pnpm asset-gate ${id})`)
const preview = tool('asset-preview', admitted)
const changed: { id: string; fraction: number }[] = []
const unchanged: string[] = []
for (const id of admitted) {
  const now = join(REPORTS, id, 'turntable.png')
  const old = join(before, `${id}.png`)
  if (!existsSync(now)) continue
  if (!existsSync(old)) { changed.push({ id, fraction: 1 }); continue }
  let fraction = 1
  if (have('magick')) {
    // `compare -metric AE` prints the quantum-scaled value, then the pixel
    // count in parentheses: "2.59951e+09 (39666)". The count is the number.
    const cmp = spawnSync('magick', ['compare', '-metric', 'AE', '-fuzz', '3%', old, now, 'null:'], { encoding: 'utf8' })
    const m = /\(([\d.e+]+)\)/.exec(cmp.stderr ?? '')
    const px = Number(m ? m[1] : (cmp.stderr ?? '').trim().split(' ')[0])
    const size = spawnSync('magick', [now, '-format', '%w %h', 'info:'], { encoding: 'utf8' }).stdout.trim().split(' ').map(Number)
    const total = (size[0] ?? 1) * (size[1] ?? 1)
    fraction = Number.isFinite(px) ? px / total : 1
  }
  const dir = join(REPORTS, id, 'regen')
  mkdirSync(dir, { recursive: true })
  cpSync(old, join(dir, 'before.png'))
  cpSync(now, join(dir, 'after.png'))
  if (fraction > 0.005) changed.push({ id, fraction: Number(fraction.toFixed(4)) })
  else unchanged.push(id)
}
rmSync(before, { recursive: true, force: true })
for (const c of changed) say(`CHANGED   ${c.id}  ${(c.fraction * 100).toFixed(1)}% of the turntable  → ${rel(join(REPORTS, c.id, 'regen'))}/`)
for (const u of unchanged) say(`same      ${u}`)
say(`${changed.length} changed visually, ${unchanged.length} unchanged, ${rejected.length} rejected`)
emit('asset-regen', build.ok && gate.ok && preview.ok, `${rebuilt.length} rebuilt, ${changed.length} changed visually, ${rejected.length} rejected`, { rebuilt, changed, unchanged, rejected })
