import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { parseArgs, say, emit, fail, selectIds, have } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry } from './lib/spec'
import { RAW, REPORTS, rel } from './lib/paths'
import { findBlender, BLENDER_INSTALL, runBlender } from './lib/blender'
import { readGlb, clips as readClips } from './lib/glb'
import { FPS } from './lib/budgets'

/**
 * asset-preview <id|all> [--lineup <class>]
 *
 * --lineup <class> renders one strip of EVERY admitted asset of that class
 * side by side at true relative scale (reports/art/lineup_<class>.png):
 * the "all creeps" and "all towers" renders the catalogue is reviewed on.
 *
 * Renders, into reports/art/<id>/:
 *   turntable.png      eight yaws at the game pitch
 *   silhouette.png     32 px flat-black tests (game pitch, side, front), with ×8 enlargements
 *   clip_<Name>.png    six frames per clip
 *   team.png           blue and red through the mask, side by side
 *   game_distance.png  true on-screen size at the fitted camera on a 1080p frame
 *   lineup.png         beside tier siblings and archetype peers, true relative scale
 *   preview.json       what was rendered, with sizes
 *
 * Reads assets/raw/<id>.glb: Blender's importer cannot read the KTX2
 * textures the gate writes into assets/build/, and the raw file has the
 * same geometry, rig and clips. (The dev asset viewer in the client shows
 * the built file.) Blender does the rendering and ImageMagick assembles
 * the strips. There is no three.js fallback: the
 * repo has no browser runner (issue #15) and a WebGL context in node would
 * be a third renderer to keep honest. Without Blender this tool says so
 * and exits 2.
 */

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const lineupClass = typeof args['lineup'] === 'string' ? args['lineup'] : null
const ids = lineupClass ? [] : selectIds(argv, listSpecIds)
if (ids.length === 0 && !lineupClass) fail('no specs selected')

const blender = findBlender()
if (!blender) {
  console.error(`missing: blender    install: ${BLENDER_INSTALL}`)
  emit('asset-preview', false, 'blender not found', { usageError: true, missing: [{ bin: 'blender', install: BLENDER_INSTALL }] })
}
if (!have('magick')) {
  console.error('missing: magick    install: brew install imagemagick')
  emit('asset-preview', false, 'imagemagick not found', { usageError: true, missing: [{ bin: 'magick', install: 'brew install imagemagick' }] })
}

const schema = loadSchema()
const registry = loadRegistry()
const allIds = listSpecIds()

function glbFor(id: string): string | null {
  const raw = join(RAW, `${id}.glb`)
  return existsSync(raw) ? raw : null
}

interface Entry { id: string; glb: string; out_dir: string; class: string; clips: Record<string, number>; height: number; siblings: { id: string; glb: string; label: string }[] }
const batch: Entry[] = []
const missing: string[] = []
for (const id of ids) {
  const r = resolveSpec(id, { schema, registry })
  if (r.problems.length) { missing.push(`${id}: invalid spec`); continue }
  const glb = glbFor(id)
  if (!glb) { missing.push(`${id}: not built (pnpm asset-build ${id})`); continue }
  const g = readGlb(glb)
  const clips: Record<string, number> = {}
  for (const c of readClips(g, FPS)) clips[c.name] = c.seconds
  // Siblings: same archetype (other tiers/levels) and same class (peers at tier 1 / level 1).
  const siblings: Entry['siblings'] = []
  for (const other of allIds) {
    const o = resolveSpec(other, { schema, registry })
    if (o.problems.length || o.spec.class !== r.spec.class) continue
    const sameArch = o.spec.archetype === r.spec.archetype
    const peerBase = (o.spec.tier ?? o.spec.level ?? 1) === 1
    if (!sameArch && !peerBase) continue
    const og = glbFor(other)
    if (!og) continue
    siblings.push({ id: other, glb: og, label: other })
  }
  siblings.sort((a, b) => (a.id === id ? -1 : b.id === id ? 1 : a.id.localeCompare(b.id)))
  batch.push({ id, glb, out_dir: join(REPORTS, id), class: r.spec.class, clips, height: 0, siblings })
}
if (lineupClass) {
  const members = allIds.filter((o) => { const r = resolveSpec(o, { schema, registry }); return !r.problems.length && r.spec.class === lineupClass && glbFor(o) })
  members.sort()
  if (members.length === 0) fail(`no built assets of class ${lineupClass}`)
  batch.push({ id: `lineup_${lineupClass}`, glb: glbFor(members[0]!)!, out_dir: join(REPORTS, `lineup_${lineupClass}`), class: lineupClass, clips: {}, height: 0, siblings: members.map((m) => ({ id: m, glb: glbFor(m)!, label: m })), lineup_only: true } as Entry & { lineup_only: boolean })
}
for (const m of missing) say(`skip     ${m}`)
if (batch.length === 0) emit('asset-preview', false, 'nothing to render', { missing })

const work = join(tmpdir(), `ltw-preview-${process.pid}`)
mkdirSync(work, { recursive: true })
const batchFile = join(work, 'batch.json')
writeFileSync(batchFile, JSON.stringify(batch))
say(`rendering ${batch.length} asset(s) in one Blender process`)
const t0 = Date.now()
const r = runBlender(blender!, 'preview.py', ['--batch', batchFile], 1_800_000)
rmSync(work, { recursive: true, force: true })
if (!r.json) {
  say(r.output.split('\n').slice(-40).join('\n'))
  emit('asset-preview', false, 'blender produced no result', {})
}

function magick(argsList: string[]): boolean {
  const m = spawnSync('magick', argsList, { encoding: 'utf8' })
  if (m.status !== 0) say(`magick: ${m.stderr.trim()}`)
  return m.status === 0
}

const results = (r.json?.['results'] as Record<string, unknown>[]) ?? []
const done: Record<string, unknown>[] = []
for (const res of results) {
  const id = String(res['id'])
  const dir = join(REPORTS, id)
  if (res['ok'] !== true) { say(`FAILED   ${id}  ${String(res['error'])}`); done.push({ id, ok: false, error: res['error'] }); continue }
  const tt = res['turntable'] as string[]
  magick([...tt, '+append', join(dir, 'turntable.png')])
  const sil = res['silhouette'] as string[]
  // 32 px high silhouettes, then ×8 nearest-neighbour so a person can see what the test saw.
  const small = sil.map((p, i) => { const o = join(dir, `_sil32_${i}.png`); magick([p, '-resize', 'x32', o]); return o })
  const big = small.map((p, i) => { const o = join(dir, `_sil256_${i}.png`); magick([p, '-filter', 'point', '-resize', '800%', o]); return o })
  magick([...small, ...big, '-background', 'white', '+append', join(dir, 'silhouette.png')])
  const team = res['team'] as string[]
  magick([...team, '+append', join(dir, 'team.png')])
  const clipFrames = (res['clips'] as Record<string, string[]>) ?? {}
  for (const [name, frames] of Object.entries(clipFrames)) magick([...frames, '+append', join(dir, `clip_${name}.png`)])
  // Tidy the frame files.
  for (const p of [...tt, ...sil, ...small, ...big, ...team, ...Object.values(clipFrames).flat()]) rmSync(p, { force: true })
  const lineup = res['lineup'] as { png: string; order: string[] } | undefined
  if (lineupClass) {
    const out = join(REPORTS, `lineup_${lineupClass}.png`)
    if (lineup) magick([lineup.png, out])
    say(`lineup   ${lineupClass}: ${lineup?.order.length ?? 0} assets → ${rel(out)}`)
    done.push({ ok: true, id, lineup: rel(out), order: lineup?.order ?? [] })
    continue
  }
  const info = {
    id,
    glb: rel(batch.find((b) => b.id === id)!.glb),
    height: res['height'],
    footprint: res['footprint'],
    px_per_unit_1080: res['px_per_unit'],
    on_screen_px: Math.round(Number(res['height']) * Number(res['px_per_unit'])),
    files: { turntable: 'turntable.png', silhouette: 'silhouette.png', team: 'team.png', game_distance: 'game_distance.png', clips: Object.fromEntries(Object.keys(clipFrames).map((n) => [n, `clip_${n}.png`])), lineup: lineup ? 'lineup.png' : null },
    lineup_order: lineup?.order ?? [],
  }
  writeFileSync(join(dir, 'preview.json'), JSON.stringify(info, null, 2))
  say(`rendered ${id}  ${Object.keys(clipFrames).length} clips · ${info.on_screen_px} px tall at game distance · ${rel(dir)}/`)
  done.push({ ok: true, ...info })
}
say(`${((Date.now() - t0) / 1000).toFixed(1)}s`)
const failed = done.filter((d) => d['ok'] !== true)
emit('asset-preview', failed.length === 0 && missing.length === 0, failed.length === 0 ? `${done.length} rendered` : `${failed.length} failed`, { rendered: done, missing })
