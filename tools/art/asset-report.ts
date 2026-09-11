import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { say, emit } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry } from './lib/spec'
import { loadManifest, saveManifest } from './lib/manifest'
import { BUDGETS, REQUIRED_CLIPS, type AssetClass } from './lib/budgets'
import { generatorVersion } from './lib/blender'
import { RAW, BUILD, REPORTS, rel } from './lib/paths'

/**
 * asset-report — one HTML page, reports/art/index.html: the catalogue,
 * budgets used against limits, missing clips, which previews exist,
 * licence status, and which specs are stale relative to the generator
 * version or their own hash. The JSON line carries the same facts for the
 * skills (`/asset status` reads it).
 */

const schema = loadSchema()
const registry = loadRegistry()
const manifest = loadManifest()
const gen = generatorVersion()

interface Row {
  id: string; class: string; archetype: string; tierOrLevel: string
  spec: 'ok' | 'invalid'; built: boolean; admitted: boolean; stale: 'fresh' | 'spec changed' | 'generator changed' | 'not built' | 'not admitted'
  triangles: number | null; triBudget: number; bytes: number | null; byteBudget: number; bones: number | null; boneBudget: number
  missingClips: string[]; previews: string[]; critique: 'none' | 'pending' | 'written'; licence: string; needsSignOff: boolean; problems: string[]
}

const rows: Row[] = []
for (const id of listSpecIds()) {
  const r = resolveSpec(id, { schema, registry })
  const cls = (r.spec.class ?? 'prop') as AssetClass
  const b = BUDGETS[cls]
  const entry = manifest.assets[id]
  const rawLog = join(RAW, `${id}.build.json`)
  let built = existsSync(join(RAW, `${id}.glb`))
  let stale: Row['stale'] = 'not built'
  if (built) {
    let key = ''
    try { key = String((JSON.parse(readFileSync(rawLog, 'utf8')) as { cache_key?: string }).cache_key ?? '') } catch { built = false }
    const [h, g] = key.split('@')
    stale = h !== r.hash ? 'spec changed' : g !== gen ? 'generator changed' : entry && existsSync(join(BUILD, `${id}.glb`)) ? (entry.spec_hash === r.hash && entry.generator_version === gen ? 'fresh' : 'spec changed') : 'not admitted'
  }
  const previewDir = join(REPORTS, id)
  const previews = ['turntable.png', 'silhouette.png', 'team.png', 'game_distance.png', 'lineup.png'].filter((f) => existsSync(join(previewDir, f)))
  const critiquePath = join(previewDir, 'critique.md')
  const critique: Row['critique'] = !existsSync(critiquePath) ? 'none' : readFileSync(critiquePath, 'utf8').includes('\nPENDING') ? 'pending' : 'written'
  const clips = entry ? Object.keys(entry.clips) : Object.keys(r.spec.animations ?? {})
  const s = r.spec.source
  rows.push({
    id, class: cls, archetype: r.spec.archetype, tierOrLevel: r.spec.tier !== undefined ? `t${r.spec.tier}` : r.spec.level !== undefined ? `l${r.spec.level}` : '',
    spec: r.problems.length ? 'invalid' : 'ok', built, admitted: !!entry && existsSync(join(BUILD, `${id}.glb`)), stale,
    triangles: entry?.triangles ?? null, triBudget: b.triangles, bytes: entry?.bytes ?? null, byteBudget: b.bytes, bones: entry?.bones ?? null, boneBudget: b.bones,
    missingClips: REQUIRED_CLIPS[cls].filter((c) => !clips.includes(c)), previews, critique,
    licence: `${s.kind}/${s.licence}`, needsSignOff: (s.kind === 'ai' || s.kind === 'freelance' || s.licence === 'other') && !s.approved_by,
    problems: r.problems.map((p) => `${p.path}: ${p.message}`),
  })
}

// Orphans: built or admitted files with no spec.
const specIds = new Set(rows.map((r) => r.id))
const orphans = Object.keys(manifest.assets).filter((id) => !specIds.has(id))
const sounds = Object.entries(manifest.sounds)
const totalBytes = rows.reduce((n, r) => n + (r.bytes ?? 0), 0) + sounds.reduce((n, [, s]) => n + s.bytes.webm + s.bytes.mp3, 0)

const bar = (v: number | null, max: number) => v === null ? '<span class="na">—</span>' : `<span class="bar"><i style="width:${Math.min(100, (v / max) * 100).toFixed(0)}%"${v > max ? ' class="over"' : ''}></i></span> ${v.toLocaleString()} / ${max.toLocaleString()}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Asset catalogue</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#222;background:#fafafa}h1{font-size:20px}h2{font-size:16px;margin-top:28px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}th{background:#eee;position:sticky;top:0}
.bar{display:inline-block;width:80px;height:8px;background:#e5e5e5;vertical-align:middle;margin-right:6px}.bar i{display:block;height:100%;background:#4caf50}.bar i.over{background:#e53935}
.ok{color:#2e7d32}.bad{color:#c62828;font-weight:600}.warn{color:#ef6c00}.na{color:#999}img{height:48px;vertical-align:middle;margin-right:4px;border:1px solid #ccc;background:#8fa0b0}code{font-size:12px}
.summary span{display:inline-block;margin-right:18px}
</style></head><body>
<h1>Asset catalogue</h1>
<p class="summary"><span>${rows.length} specs</span><span>${rows.filter((r) => r.admitted).length} admitted</span><span>${rows.filter((r) => r.stale !== 'fresh').length} stale or unbuilt</span><span>${sounds.length} sounds</span><span>${(totalBytes / 1024).toFixed(0)} KB in assets/build</span><span>generator ${gen}</span></p>
<h2>Assets</h2>
<table><tr><th>id</th><th>class</th><th>state</th><th>triangles</th><th>bones</th><th>bytes</th><th>clips</th><th>previews</th><th>critique</th><th>licence</th></tr>
${rows.map((r) => `<tr><td><code>${r.id}</code>${r.problems.length ? `<br><span class="bad">${esc(r.problems.join('; '))}</span>` : ''}</td><td>${r.class} ${r.archetype} ${r.tierOrLevel}</td>
<td class="${r.stale === 'fresh' ? 'ok' : r.spec === 'invalid' ? 'bad' : 'warn'}">${r.spec === 'invalid' ? 'invalid spec' : r.stale}</td>
<td>${bar(r.triangles, r.triBudget)}</td><td>${bar(r.bones, r.boneBudget)}</td><td>${bar(r.bytes, r.byteBudget)}</td>
<td>${r.missingClips.length ? `<span class="bad">missing ${r.missingClips.join(', ')}</span>` : '<span class="ok">complete</span>'}</td>
<td>${r.previews.length ? r.previews.map((p) => `<a href="${r.id}/${p}"><img src="${r.id}/${p}" alt="${p}"></a>`).join('') : '<span class="na">none</span>'}</td>
<td class="${r.critique === 'written' ? 'ok' : r.critique === 'pending' ? 'warn' : 'na'}">${r.critique === 'none' ? 'none' : `<a href="${r.id}/critique.md">${r.critique}</a>`}</td>
<td>${r.licence}${r.needsSignOff ? ' <span class="bad">needs sign-off</span>' : ''}</td></tr>`).join('\n')}
</table>
${orphans.length ? `<h2>Orphans</h2><p class="bad">In the manifest with no spec: ${orphans.map((o) => `<code>${o}</code>`).join(', ')}. <code>/asset retire</code> them or restore the spec.</p>` : ''}
<h2>Sounds</h2>
${sounds.length ? `<table><tr><th>id</th><th>event</th><th>seconds</th><th>LUFS</th><th>peak dBTP</th><th>webm</th><th>mp3</th><th>licence</th></tr>${sounds.map(([id, s]) => `<tr><td><code>${id}</code></td><td>${s.event} #${s.variant}</td><td>${s.seconds}</td><td>${s.lufs}</td><td>${s.peak_dbtp}</td><td>${(s.bytes.webm / 1024).toFixed(1)} KB</td><td>${(s.bytes.mp3 / 1024).toFixed(1)} KB</td><td>${s.source.kind}/${s.source.licence}</td></tr>`).join('')}</table>` : '<p class="na">No sounds admitted yet.</p>'}
<h2>Budgets</h2>
<table><tr><th>class</th><th>triangles</th><th>texture</th><th>bones</th><th>file</th><th>required clips</th></tr>
${(Object.keys(BUDGETS) as AssetClass[]).map((c) => `<tr><td>${c}</td><td>${BUDGETS[c].triangles}</td><td>${BUDGETS[c].textureSize}²</td><td>${BUDGETS[c].bones}</td><td>${BUDGETS[c].bytes / 1024} KB</td><td>${REQUIRED_CLIPS[c].join(', ') || '—'}</td></tr>`).join('')}
</table>
<p><small>Generated by <code>pnpm asset-report</code>. Previews come from <code>asset-preview</code>, admission from <code>asset-gate</code>; nothing here is edited by hand.</small></p>
</body></html>`
// LICENSES.md is derived from the manifest; regenerating it here means the
// Stop guard's "LICENSES.md must be current" check is one command away.
saveManifest(manifest)
mkdirSync(REPORTS, { recursive: true })
const out = join(REPORTS, 'index.html')
writeFileSync(out, html)
for (const r of rows) say(`${r.stale === 'fresh' ? 'fresh   ' : r.spec === 'invalid' ? 'INVALID ' : 'STALE   '} ${r.id}  ${r.class}${r.missingClips.length ? `  missing ${r.missingClips.join(',')}` : ''}${r.needsSignOff ? '  NEEDS SIGN-OFF' : ''}  critique:${r.critique}`)
say(`report: ${rel(out)} (${(statSync(out).size / 1024).toFixed(0)} KB)`)
const stale = rows.filter((r) => r.stale !== 'fresh' || r.spec === 'invalid')
emit('asset-report', true, `${rows.length} specs, ${rows.filter((r) => r.admitted).length} admitted, ${stale.length} stale`, {
  report: rel(out), generatorVersion: gen, rows, orphans, sounds: sounds.map(([id]) => id),
  awaitingApproval: rows.filter((r) => r.critique === 'pending').map((r) => r.id),
  needsSignOff: rows.filter((r) => r.needsSignOff).map((r) => r.id),
})
