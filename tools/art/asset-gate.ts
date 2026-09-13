import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs, flag, say, emit, fail, selectIds, have } from './lib/cli'
import { listSpecIds, resolveSpec, loadSchema, loadRegistry, type Registry } from './lib/spec'
import type { AssetSpec } from './lib/spec.generated'
import { RAW, BUILD, REPORTS } from './lib/paths'
import { generatorVersion } from './lib/blender'
import { readGlb, triangleCount, bounds, clips, type Glb } from './lib/glb'
import { BUDGETS, FPS, REQUIRED_CLIPS, ALL_CLIPS, LOOP_CLIPS, CLIP_LENGTH, TEAM_MASK_COVERAGE, TEAM_MASK_CLASSES, SEAM_TRANSLATION, SEAM_ROTATION_RAD, ROOT_DRIFT, ORIGIN_TOLERANCE, type AssetClass } from './lib/budgets'
import { loadManifest, saveManifest, type AssetEntry, type ClipEntry } from './lib/manifest'
import { compressGlb, ktxBinary } from './lib/compress'

/**
 * asset-gate <id|all> [--changed] [--report]
 *
 * The admission gate. Reads assets/raw/<id>.glb, checks it against the
 * budgets and the animation contract, and REJECTS with every violation
 * listed. Never fixes, never relaxes. On pass: compresses (meshopt), encodes
 * the texture to KTX2 (UASTC, because the alpha channel is the team mask
 * and ETC1S would smear it), writes assets/build/<id>.glb, and records the
 * asset in assets/manifest.json with its counts, hash, spec hash, source
 * and licence. assets/LICENSES.md is regenerated with the manifest.
 *
 * Every check is a function returning zero or more violations, so a new
 * rule is one more function in CHECKS and one more line in the style sheet.
 */

interface Violation { code: string; message: string; fix: string }
interface Ctx { id: string; spec: AssetSpec; cls: AssetClass; glb: Glb; rawPath: string; log: Record<string, unknown> | null; specHash: string; registry: Registry }

const KTX_HINT = 'KTX-Software from https://github.com/KhronosGroup/KTX-Software/releases (the macOS .pkg; expand with pkgutil into ~/.local/opt/ktx and link bin/ktx into ~/.local/bin if you would rather not install system-wide)'


const CHECKS: ((c: Ctx) => Violation[])[] = [
  function stale(c) {
    const key = `${c.specHash}@${generatorVersion()}`
    const logged = c.log?.['cache_key']
    if (logged !== key) return [{ code: 'StaleBuild', message: `assets/raw/${c.id}.glb was built from ${String(logged ?? 'an unknown spec')}, and the spec is now ${key}`, fix: `pnpm asset-build ${c.id}` }]
    return []
  },
  function licence(c) {
    const s = c.spec.source
    const out: Violation[] = []
    if (!s.licence) out.push({ code: 'NoLicence', message: 'source.licence is missing', fix: 'set source.licence to own, cc0, cc-by or other' })
    if ((s.kind === 'ai' || s.kind === 'freelance' || s.licence === 'other') && !s.approved_by) {
      out.push({ code: 'NeedsSignOff', message: `a ${s.kind} / ${s.licence} source ships only after sign-off, and source.approved_by is empty`, fix: 'record approved_by and approved_on in the spec once the owner has signed off' })
    }
    if (s.licence === 'cc-by' && !s.attribution) out.push({ code: 'NoAttribution', message: 'cc-by needs an attribution line', fix: 'set source.attribution to the exact line for LICENSES.md' })
    return out
  },
  function triangles(c) {
    const n = triangleCount(c.glb)
    const b = BUDGETS[c.cls]
    return n > b.triangles ? [{ code: 'OverTriangleBudget', message: `${n} triangles, budget ${b.triangles} for a ${c.cls}`, fix: 'fewer segments on round primitives, fewer parts, or a smaller bevel; --dry-run shows the estimate per plan' }] : []
  },
  function textures(c) {
    const b = BUDGETS[c.cls]
    const out: Violation[] = []
    const images = c.glb.json.images ?? []
    if (images.length > b.textures) out.push({ code: 'TooManyTextures', message: `${images.length} textures, budget ${b.textures}`, fix: 'one albedo per asset; the palette and mask are baked into it' })
    for (const img of images) {
      if (img.bufferView === undefined) continue
      const v = c.glb.json.bufferViews[img.bufferView]
      if (!v) continue
      const data = c.glb.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength)
      const dims = pngDims(data)
      if (dims && (dims.w > b.textureSize || dims.h > b.textureSize)) out.push({ code: 'TextureTooLarge', message: `${img.name ?? 'texture'} is ${dims.w}×${dims.h}, budget ${b.textureSize}²`, fix: 'the builder sizes textures by class; an import must be re-baked, not resized' })
      if (dims && dims.w !== dims.h) out.push({ code: 'TextureNotSquare', message: `${img.name ?? 'texture'} is ${dims.w}×${dims.h}`, fix: 'textures are square' })
    }
    return out
  },
  function bones(c) {
    const b = BUDGETS[c.cls]
    const n = Math.max(0, ...(c.glb.json.skins ?? []).map((s) => s.joints.length))
    return n > b.bones ? [{ code: 'OverBoneBudget', message: `${n} bones, budget ${b.bones} for a ${c.cls}`, fix: 'use a smaller rig template' }] : []
  },
  function requiredClips(c) {
    const have = new Set((c.glb.json.animations ?? []).map((a) => a.name ?? ''))
    const out: Violation[] = []
    for (const name of REQUIRED_CLIPS[c.cls]) if (!have.has(name)) out.push({ code: 'MissingClip', message: `no ${name} clip; a ${c.cls} needs ${REQUIRED_CLIPS[c.cls].join(', ')}`, fix: `add animations.${name} to the spec` })
    for (const name of have) if (!(ALL_CLIPS as readonly string[]).includes(name)) out.push({ code: 'UnknownClip', message: `clip "${name}" is not in the animation contract`, fix: `contract names are ${ALL_CLIPS.join(', ')}, exactly` })
    if (REQUIRED_CLIPS[c.cls].length === 0 && have.size > 0 && c.cls !== 'prop') out.push({ code: 'UnexpectedClips', message: `a ${c.cls} carries clips (${[...have].join(', ')}); the pool animates it`, fix: 'remove animations from the spec' })
    return out
  },
  function clipContract(c) {
    const out: Violation[] = []
    for (const k of clips(c.glb, FPS)) {
      const range = CLIP_LENGTH[k.name]
      if (range && (k.seconds < range[0] - 0.02 || k.seconds > range[1] + 0.02)) out.push({ code: 'ClipLength', message: `${k.name} is ${k.seconds.toFixed(2)} s; the contract says ${range[0]}–${range[1]} s`, fix: `set animations.${k.name}.duration (or cadence for Walk)` })
      if (!k.onGrid) out.push({ code: 'OffGrid', message: `${k.name} has keyframes off the ${FPS} fps grid`, fix: 'the builder samples every frame; an import must be exported with sampling at 24 fps' })
      if (LOOP_CLIPS.has(k.name)) {
        if (k.seamTranslation > SEAM_TRANSLATION || k.seamRotation > SEAM_ROTATION_RAD) out.push({ code: 'LoopSeam', message: `${k.name} does not loop cleanly: first/last pose differ by ${(k.seamTranslation * 1000).toFixed(1)} mm / ${((k.seamRotation * 180) / Math.PI).toFixed(2)}°`, fix: 'a loop generator must close on frame N = frame 0; an import needs a seamless cycle' })
        if (k.rootDrift > ROOT_DRIFT) out.push({ code: 'RootMotion', message: `${k.name} moves the root ${k.rootDrift.toFixed(3)} units horizontally; loops cycle in place`, fix: 'remove root translation from the cycle; the sim owns position' })
      }
    }
    return out
  },
  function origin(c) {
    const b = bounds(c.glb)
    if (!b) return [{ code: 'NoGeometry', message: 'no mesh in the file', fix: 'the build produced nothing' }]
    const out: Violation[] = []
    const cx = (b.min[0]! + b.max[0]!) / 2
    const cz = (b.min[2]! + b.max[2]!) / 2
    if (Math.abs(cx) > 0.01 || Math.abs(cz) > 0.01) out.push({ code: 'OffCentre', message: `footprint centre is (${cx.toFixed(3)}, ${cz.toFixed(3)}), must be (0, 0)`, fix: 'the origin is the centre of the footprint' })
    if (c.cls === 'projectile') {
      const cy = (b.min[1]! + b.max[1]!) / 2
      if (Math.abs(cy) > 0.01) out.push({ code: 'OffCentre', message: `a projectile is centred on its origin; y centre is ${cy.toFixed(3)}`, fix: 'centre the model' })
    } else if (c.spec.body_plan === 'hover') {
      if (b.min[1]! < -ORIGIN_TOLERANCE) out.push({ code: 'BelowGround', message: `lowest point at y=${b.min[1]!.toFixed(3)}`, fix: 'nothing below y = 0' })
    } else if (Math.abs(b.min[1]!) > ORIGIN_TOLERANCE) {
      out.push({ code: 'NotGrounded', message: `lowest point at y=${b.min[1]!.toFixed(3)}, must be 0`, fix: 'the origin is at the base' })
    }
    return out
  },
  function scale(c) {
    const b = bounds(c.glb)
    if (!b) return []
    const bud = BUDGETS[c.cls]
    const height = b.max[1]! - b.min[1]!
    const footprint = Math.max(b.max[0]! - b.min[0]!, b.max[2]! - b.min[2]!)
    const out: Violation[] = []
    if (height < bud.height[0] - 0.001 || height > bud.height[1] + 0.001) out.push({ code: 'Scale', message: `height ${height.toFixed(3)} tiles; a ${c.cls} is ${bud.height[0]}–${bud.height[1]}`, fix: 'set params.height (or import.scale)' })
    if (footprint > bud.footprint + 0.01) out.push({ code: 'Footprint', message: `footprint ${footprint.toFixed(3)} tiles, limit ${bud.footprint} for a ${c.cls}`, fix: c.cls === 'tower' ? 'a tower stays inside 0.84 of its 2x2 footprint so a one-tile corridor beside it stays visible' : 'shrink the body plan' })
    if (bud.width !== undefined) {
      const width = b.max[0]! - b.min[0]!
      if (width > bud.width + 0.01) out.push({ code: 'Width', message: `width ${width.toFixed(3)} tiles across the walking axis, limit ${bud.width} for a ${c.cls}`, fix: 'a creep must pass a one-tile corridor with a margin; narrow the body plan' })
    }
    return out
  },
  function materials(c) {
    const out: Violation[] = []
    const mats = c.glb.json.materials ?? []
    for (const m of mats) {
      const name = m.name ?? ''
      if (name !== 'body' && name !== 'glow') out.push({ code: 'UnknownMaterial', message: `material "${name}"; the client knows body and glow`, fix: 'the builder writes exactly these two; an import must be re-materialled' })
      if (m.alphaMode && m.alphaMode !== 'OPAQUE') out.push({ code: 'AlphaMode', message: `${name} is ${m.alphaMode}; the alpha channel is the team mask, not transparency`, fix: 'alphaMode OPAQUE' })
      if (name === 'body' && !m.pbrMetallicRoughness?.baseColorTexture) out.push({ code: 'NoAlbedo', message: 'body has no baseColorTexture', fix: 'the bake did not land in the material' })
    }
    return out
  },
  function teamMask(c) {
    if (!TEAM_MASK_CLASSES.has(c.cls)) return []
    const out: Violation[] = []
    if (!c.spec.palette?.team_mask?.length) out.push({ code: 'NoTeamMask', message: `a ${c.cls} needs palette.team_mask slots`, fix: 'list the slots the owner colour tints (torso_stripe, head_crest, banner…)' })
    const png = join(RAW, `${c.id}.albedo.png`)
    if (!existsSync(png)) return out
    const cov = maskCoverage(png)
    if (cov === null) return out
    if (cov < TEAM_MASK_COVERAGE[0] || cov > TEAM_MASK_COVERAGE[1]) out.push({ code: 'TeamMaskCoverage', message: `team mask covers ${(cov * 100).toFixed(1)}% of the used texels; the style sheet wants ${TEAM_MASK_COVERAGE[0] * 100}–${TEAM_MASK_COVERAGE[1] * 100}%`, fix: cov < TEAM_MASK_COVERAGE[0] ? 'add a slot to palette.team_mask or enlarge the stripe' : 'remove a slot from palette.team_mask' })
    return out
  },
]

function pngDims(data: Buffer): { w: number; h: number } | null {
  if (data.length < 24 || data.readUInt32BE(0) !== 0x89504e47) return null
  return { w: data.readUInt32BE(16), h: data.readUInt32BE(20) }
}

/** Fraction of USED texels (any colour) whose alpha is above one half. Via ImageMagick. */
function maskCoverage(png: string): number | null {
  if (!have('magick')) return null
  const q = (expr: string[]) => {
    const r = spawnSync('magick', [png, ...expr, '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8' })
    return r.status === 0 ? Number(r.stdout.trim()) : NaN
  }
  const mask = q(['-alpha', 'extract', '-threshold', '50%'])
  const used = q(['-alpha', 'off', '-colorspace', 'gray', '-threshold', '0.5%'])
  if (!Number.isFinite(mask) || !Number.isFinite(used) || used <= 0) return null
  return mask / used
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const args = parseArgs(argv)
const ids = selectIds(argv, listSpecIds)
if (ids.length === 0) fail('no specs selected')

const missing: { bin: string; install: string }[] = []
if (!ktxBinary()) missing.push({ bin: 'ktx', install: KTX_HINT })
if (!have('magick')) missing.push({ bin: 'magick', install: 'brew install imagemagick' })
if (missing.length) {
  for (const m of missing) console.error(`missing: ${m.bin}    install: ${m.install}`)
  emit('asset-gate', false, `missing tools: ${missing.map((m) => m.bin).join(', ')}`, { usageError: true, missing })
}

const schema = loadSchema()
const registry = loadRegistry()
const manifest = loadManifest()
mkdirSync(BUILD, { recursive: true })
mkdirSync(REPORTS, { recursive: true })

const results: { id: string; ok: boolean; violations: Violation[]; entry?: AssetEntry; skipped?: string }[] = []

for (const id of ids) {
  const r = resolveSpec(id, { schema, registry })
  if (r.problems.length) {
    results.push({ id, ok: false, violations: r.problems.map((p) => ({ code: 'InvalidSpec', message: `${p.path}: ${p.message}`, fix: 'pnpm spec-validate ' + id })) })
    continue
  }
  const rawPath = join(RAW, `${id}.glb`)
  if (!existsSync(rawPath)) {
    results.push({ id, ok: false, violations: [{ code: 'NotBuilt', message: `no assets/raw/${id}.glb`, fix: `pnpm asset-build ${id}` }] })
    continue
  }
  const logPath = join(RAW, `${id}.build.json`)
  const log = existsSync(logPath) ? (JSON.parse(readFileSync(logPath, 'utf8')) as Record<string, unknown>) : null
  if (flag(args, 'changed') && manifest.assets[id]?.spec_hash === r.hash && manifest.assets[id]?.generator_version === generatorVersion() && existsSync(join(BUILD, `${id}.glb`))) {
    results.push({ id, ok: true, violations: [], skipped: 'already admitted at this spec hash' })
    continue
  }
  const glb = readGlb(rawPath)
  const ctx: Ctx = { id, spec: r.spec, cls: r.spec.class, glb, rawPath, log, specHash: r.hash, registry }
  const violations = CHECKS.flatMap((check) => check(ctx))
  if (violations.length) {
    results.push({ id, ok: false, violations })
    continue
  }
  // Admit: compress, hash, record.
  const outPath = join(BUILD, `${id}.glb`)
  const comp = await compressGlb(rawPath, outPath)
  if (!comp.ok) {
    results.push({ id, ok: false, violations: [{ code: 'CompressFailed', message: comp.log.split('\n').filter(Boolean).slice(-3).join(' | '), fix: 'see the ktx / gltf-transform output above' }] })
    continue
  }
  const bytes = statSync(outPath).size
  const budget = BUDGETS[ctx.cls]
  if (bytes > budget.bytes) {
    rmSync(outPath, { force: true })
    results.push({ id, ok: false, violations: [{ code: 'OverFileBudget', message: `${(bytes / 1024).toFixed(0)} KB after compression, budget ${budget.bytes / 1024} KB`, fix: 'fewer triangles or shorter clips; the texture is already KTX2' }] })
    continue
  }
  // Counts, bounds and clip timings come from the RAW file: the built one
  // is meshopt-compressed and quantised, and reading its accessors without
  // the decoder gives nonsense (a height of 46620 tiles, once). Only the
  // byte size and the hash are the built file's.
  const built = readGlb(outPath)
  const b = bounds(glb)!
  const clipEntries: Record<string, ClipEntry> = {}
  for (const k of clips(glb, FPS)) {
    const specAnim = r.spec.animations?.[k.name]
    const gen = specAnim ? registry.animations[specAnim.gen] : undefined
    const markers: Record<string, number> = { ...(gen ? defaultMarkers(specAnim!, registry) : {}), ...(specAnim?.markers ?? {}) }
    clipEntries[k.name] = { seconds: Number(k.seconds.toFixed(4)), loop: LOOP_CLIPS.has(k.name), markers, ...(specAnim?.stride !== undefined ? { stride: specAnim.stride } : {}) }
  }
  const prev = manifest.assets[id]
  const hash = sha256(outPath)
  const muzzleNode = glb.json.nodes.find((n) => n.name === 'muzzle')
  const entry: AssetEntry = {
    class: ctx.cls,
    archetype: r.spec.archetype,
    ...(r.spec.tier !== undefined ? { tier: r.spec.tier } : {}),
    ...(r.spec.level !== undefined ? { level: r.spec.level } : {}),
    ...(r.spec.derived_from ? { derived_from: r.spec.derived_from } : {}),
    file: `build/${id}.glb`,
    bytes,
    hash,
    spec_hash: r.hash,
    generator_version: generatorVersion(),
    version: prev ? (prev.hash === hash ? prev.version : prev.version + 1) : 1,
    triangles: triangleCount(glb),
    vertices: (glb.json.meshes ?? []).flatMap((m) => m.primitives).reduce((n, p) => n + (glb.json.accessors[p.attributes['POSITION'] ?? -1]?.count ?? 0), 0),
    bones: Math.max(0, ...(glb.json.skins ?? []).map((s) => s.joints.length)),
    textures: (built.json.images ?? []).map((img) => ({ size: BUDGETS[ctx.cls].textureSize, format: img.mimeType ?? 'image/ktx2' })),
    extensions: built.json.extensionsRequired ?? [],
    clips: clipEntries,
    height: Number((b.max[1]! - b.min[1]!).toFixed(4)),
    footprint: Number(Math.max(b.max[0]! - b.min[0]!, b.max[2]! - b.min[2]!).toFixed(4)),
    ...(muzzleNode?.translation ? { muzzle: worldOf(glb, muzzleNode) } : {}),
    audio: { ...(r.spec.audio ?? {}) },
    source: { kind: r.spec.source.kind, licence: r.spec.source.licence, author: r.spec.source.author ?? '', url: r.spec.source.url ?? '', attribution: r.spec.source.attribution ?? '', service: r.spec.source.service ?? '', approved_by: r.spec.source.approved_by ?? '' },
    gated_by: 'asset-gate',
  }
  manifest.assets[id] = entry
  results.push({ id, ok: true, violations: [], entry })
}

function defaultMarkers(anim: { gen: string; [k: string]: unknown }, reg: Registry): Record<string, number> {
  const gen = reg.animations[anim.gen]
  if (!gen) return {}
  const out: Record<string, number> = {}
  for (const m of ['fire', 'land', 'impact'] as const) {
    const p = gen.params[m]
    if (p) out[m] = typeof anim[m] === 'number' ? (anim[m] as number) : (p.default as number)
  }
  return out
}

function worldOf(_g: Glb, node: { translation?: number[] }): [number, number, number] {
  // The muzzle empty is parented to the armature or the mesh, both at the origin.
  const t = node.translation ?? [0, 0, 0]
  return [Number(t[0]!.toFixed(4)), Number(t[1]!.toFixed(4)), Number(t[2]!.toFixed(4))]
}

const admitted = results.filter((x) => x.ok && x.entry)
if (admitted.length) saveManifest(manifest)

for (const x of results) {
  if (x.skipped) say(`skip     ${x.id}  ${x.skipped}`)
  else if (x.ok) say(`ADMIT    ${x.id}  ${x.entry ? `${x.entry.triangles} tris · ${x.entry.bones} bones · ${Object.keys(x.entry.clips).length} clips · ${(x.entry.bytes / 1024).toFixed(0)} KB · v${x.entry.version}` : ''}`)
  else {
    say(`REJECT   ${x.id}  (${x.violations.length} violation${x.violations.length === 1 ? '' : 's'})`)
    for (const v of x.violations) say(`           ${v.code}: ${v.message}\n             fix: ${v.fix}`)
  }
}
const rejected = results.filter((x) => !x.ok)
if (flag(args, 'report')) writeFileSync(join(REPORTS, 'gate.json'), JSON.stringify(results, null, 2))
say()
say(`${admitted.length} admitted, ${results.filter((x) => x.skipped).length} unchanged, ${rejected.length} rejected`)
emit('asset-gate', rejected.length === 0, rejected.length === 0 ? `${admitted.length} admitted` : `${rejected.length} rejected`, {
  admitted: admitted.map((x) => x.id),
  rejected: rejected.map((x) => ({ id: x.id, violations: x.violations })),
  unchanged: results.filter((x) => x.skipped).map((x) => x.id),
})
