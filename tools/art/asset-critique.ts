import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, say, emit, fail, have } from './lib/cli'
import { resolveSpec, loadSchema, loadRegistry } from './lib/spec'
import { REPORTS, rel } from './lib/paths'
import { loadManifest } from './lib/manifest'

/**
 * asset-critique <id>
 *
 * Writes reports/art/<id>/critique.md: the numeric half of the critique
 * (what a script can measure from the previews) and a scaffold for the
 * half only eyes can judge, which the art-director subagent fills in by
 * looking at the images. The numeric half:
 *
 *   silhouette   how different the 32 px silhouette is from every peer's
 *                (pixel agreement of the black masks; under ~0.75 is distinct)
 *   palette      what fraction of the turntable's pixels sit near a palette
 *                colour (a toon asset is nearly all palette)
 *   team         how much the blue and red renders differ (a mask that is
 *                invisible at game distance is a mask that does nothing)
 *   readability  the asset's height in pixels at the fitted camera on 1080p
 *   tier         size and part deltas against the parent spec
 *
 * The verdict line stays PENDING until the art-director writes it.
 */

const argv = process.argv.slice(2)
parseArgs(argv)
const id = argv.find((a) => !a.startsWith('--'))
if (!id) fail('asset-critique <id>')
if (!have('magick')) fail('imagemagick not found: brew install imagemagick')

const dir = join(REPORTS, id)
const previewJson = join(dir, 'preview.json')
if (!existsSync(previewJson)) fail(`no previews for ${id}: pnpm asset-preview ${id}`)
const preview = JSON.parse(readFileSync(previewJson, 'utf8')) as { height: number; on_screen_px: number; lineup_order: string[]; files: { clips: Record<string, string> } }
const schema = loadSchema()
const registry = loadRegistry()
const r = resolveSpec(id, { schema, registry })
if (r.problems.length) fail(`${id}: invalid spec`)
const spec = r.spec
const manifest = loadManifest()

function fx(args: string[]): number {
  const m = spawnSync('magick', args, { encoding: 'utf8' })
  return m.status === 0 ? Number(m.stdout.trim()) : NaN
}

// --- silhouette distinctness against peers ---------------------------------
// The silhouette strip is [32px game, side, front, then ×8 of each]. Crop the
// three 32 px tiles and compare each against the peer's, normalised to 32×32.
function silTile(assetId: string, i: number): string | null {
  const strip = join(REPORTS, assetId, 'silhouette.png')
  if (!existsSync(strip)) return null
  const out = join(REPORTS, assetId, `_cmp_${i}.png`)
  const w = fx(['identify', '-format', '%w', strip].slice(1).length ? [strip, '-format', '%w', 'info:'] : [strip, '-format', '%w', 'info:'])
  void w
  // The three small tiles are each 32 px high with width ≤ 32; total small width = sum. Simplest: take the first 96 px and split in thirds.
  const m = spawnSync('magick', [strip, '-crop', `32x32+${i * 32}+0`, '+repage', '-threshold', '50%', '-negate', '-background', 'white', '-gravity', 'center', '-extent', '32x32', out], { encoding: 'utf8' })
  return m.status === 0 ? out : null
}
// Silhouette distinctness is a creature-and-tower rule (style sheet §4): a
// tile is a slab and a shell is a dot, and comparing those is noise.
const judged = spec.class === 'creep' || spec.class === 'tower'
const peers = judged ? preview.lineup_order.filter((p) => p !== id && (manifest.assets[p]?.archetype ?? resolveSpec(p, { schema, registry }).spec.archetype) !== spec.archetype) : []
const silhouette: { peer: string; agreement: number }[] = []
for (const peer of peers) {
  let worst = 0
  for (let i = 0; i < 3; i++) {
    const a = silTile(id, i)
    const b = silTile(peer, i)
    if (!a || !b) continue
    // Fraction of pixels that agree (both black or both white). 1.0 = identical.
    const diff = fx([a, b, '-compose', 'difference', '-composite', '-threshold', '50%', '-format', '%[fx:mean]', 'info:'])
    if (Number.isFinite(diff)) worst = Math.max(worst, 1 - diff)
  }
  silhouette.push({ peer, agreement: Number(worst.toFixed(3)) })
}

// --- palette compliance -------------------------------------------------------
const turntable = join(dir, 'turntable.png')
const paletteHex = Object.values(registry.palette)
// Quantise the turntable to the palette -- each colour lit AND in the toon
// shadow step (×0.55, the ramp in preview.py) -- plus the background, and
// measure how far pixels moved. A toon asset should barely move.
const shade = (hex: string) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55).toString(16).padStart(2, '0')).join('')
const mapPng = join(dir, '_palette_map.png')
const swatches = [...paletteHex, ...paletteHex.map(shade)].map((h) => `xc:${h}`)
spawnSync('magick', [...swatches, '+append', mapPng], { encoding: 'utf8' })
// The background is most of a turntable frame; measure only the model's
// pixels (everything that is not the corner colour).
const bg = spawnSync('magick', [turntable, '-format', '%[pixel:p{1,1}]', 'info:'], { encoding: 'utf8' }).stdout.trim() || 'black'
const modelFrac = 1 - fx([turntable, '-fuzz', '4%', '-fill', 'white', '+opaque', bg, '-fill', 'black', '-opaque', bg, '-colorspace', 'gray', '-negate', '-format', '%[fx:mean]', 'info:'])
const errorTotal = fx([turntable, '(', '+clone', '-remap', mapPng, ')', '-compose', 'difference', '-composite', '-colorspace', 'gray', '-write', 'mpr:d', '+delete', turntable, '-fuzz', '4%', '-fill', 'black', '-opaque', bg, '-fill', 'white', '+opaque', 'black', '-colorspace', 'gray', 'mpr:d', '-compose', 'multiply', '-composite', '-format', '%[fx:mean]', 'info:'])
const paletteError = Number.isFinite(errorTotal) && modelFrac > 0.001 ? errorTotal / modelFrac : NaN
const paletteScore = Number.isFinite(paletteError) ? Number((1 - Math.min(1, paletteError * 4)).toFixed(3)) : NaN

// --- team colour visibility -------------------------------------------------
const teamStrip = join(dir, 'team.png')
const teamA = join(dir, '_team_a.png')
const teamB = join(dir, '_team_b.png')
spawnSync('magick', [teamStrip, '-crop', '50%x100%+0+0', '+repage', teamA], { encoding: 'utf8' })
spawnSync('magick', [teamStrip, '-gravity', 'East', '-crop', '50%x100%+0+0', '+repage', teamB], { encoding: 'utf8' })
const teamDiff = judged ? fx([teamA, teamB, '-compose', 'difference', '-composite', '-colorspace', 'gray', '-threshold', '8%', '-format', '%[fx:mean]', 'info:']) : NaN

// --- tier language -----------------------------------------------------------
let tier = ''
if (spec.derived_from) {
  const parent = resolveSpec(spec.derived_from, { schema, registry })
  const ph = Number((parent.spec.params as Record<string, unknown> | undefined)?.['height'] ?? 0)
  const ch = Number((spec.params as Record<string, unknown> | undefined)?.['height'] ?? 0)
  const pparts = (parent.spec.params?.parts ?? []).map((p) => (typeof p === 'string' ? p : p.part))
  const cparts = (spec.params?.parts ?? []).map((p) => (typeof p === 'string' ? p : p.part))
  const added = cparts.filter((p) => !pparts.includes(p))
  tier = `size ×${ph > 0 ? (ch / ph).toFixed(2) : '?'} vs ${spec.derived_from} (style sheet: 1.10 / 1.20) · parts added: ${added.join(', ') || 'none'} · tier_shift ${spec.palette?.tier_shift ?? 0} · trim ${spec.palette?.trim ? 'on' : 'off'}`
}

const clipsList = Object.keys(preview.files.clips)
const lines = [
  `# Critique — \`${id}\``,
  '',
  `*Numeric half written by \`asset-critique\`; the judgement half is the art-director's. Style sheet: docs/art/style-sheet.md.*`,
  '',
  '## Measured',
  '',
  '| Check | Value | Reads as |',
  '|---|---|---|',
  `| Readability at game distance | ${preview.on_screen_px} px tall on a 1080p frame at the fitted camera | ${!judged ? 'n/a (drawn by a pool or the board, not read as a creature)' : preview.on_screen_px >= 24 ? 'legible' : preview.on_screen_px >= 14 ? 'small; silhouette must carry it' : 'too small to read alone (swarm-class)'} |`,
  ...silhouette.map((s) => `| Silhouette vs \`${s.peer}\` | ${(s.agreement * 100).toFixed(0)}% pixel agreement at 32 px | ${s.agreement < 0.75 ? 'distinct' : s.agreement < 0.85 ? 'borderline' : 'TOO SIMILAR'} |`),
  `| Palette compliance | ${Number.isFinite(paletteScore) ? (paletteScore * 100).toFixed(0) + '%' : 'n/a'} of turntable pixels on the palette | ${paletteScore >= 0.9 ? 'pass' : paletteScore >= 0.8 ? 'check shading' : 'FAIL: off-palette colour'} |`,
  `| Team colour visibility | ${Number.isFinite(teamDiff) ? (teamDiff * 100).toFixed(1) + '%' : 'n/a'} of the view changes between blue and red | ${!judged ? 'n/a (no team mask on this class)' : teamDiff >= 0.02 ? 'visible' : teamDiff >= 0.008 ? 'faint' : 'INVISIBLE'} |`,
  ...(tier ? [`| Tier language | ${tier} | see style sheet §5 |`] : []),
  '',
  '## Previews',
  '',
  `- turntable: ![](turntable.png)`,
  `- silhouettes (32 px, then ×8): ![](silhouette.png)`,
  `- team A/B: ![](team.png)`,
  `- game distance: ![](game_distance.png)`,
  ...clipsList.map((c) => `- ${c}: ![](clip_${c}.png)`),
  ...(existsSync(join(dir, 'lineup.png')) ? [`- lineup (${preview.lineup_order.join(', ')}): ![](lineup.png)`] : []),
  '',
  '## Judgement (art-director fills in)',
  '',
  '| Criterion | Pass / Fail | Notes |',
  '|---|---|---|',
  '| Silhouette matches the archetype rule (§4) | | |',
  '| Reads at game distance without a caption | | |',
  '| Palette blocked, not blended; two or three colours | | |',
  '| Loop quality: Walk and Idle have no visible seam or foot slide | | |',
  '| One-shots end where the contract says | | |',
  ...(tier ? ['| Tier reads as "more of the same" (§5) | | |'] : []),
  '| Team colour visible and in the right place | | |',
  '| No Warcraft look-alike | | |',
  '',
  '## Parameter changes to try',
  '',
  '- ',
  '',
  '## Verdict',
  '',
  'PENDING',
  '',
]
writeFileSync(join(dir, 'critique.md'), lines.join('\n'))
say(`critique: ${rel(join(dir, 'critique.md'))}`)
for (const l of lines.slice(6, 12)) say(l)
emit('asset-critique', true, `numeric critique written for ${id}`, { id, on_screen_px: preview.on_screen_px, silhouette, paletteScore, teamDiff, tier })
