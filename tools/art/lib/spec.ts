import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import type { AssetSpec } from './spec.generated'

/**
 * Specs: load, inherit, default, validate, hash.
 *
 * A spec is a small YAML file; the RESOLVED spec is what everything else
 * consumes -- the builder, the gate, the manifest. Resolution is:
 *
 *   1. load the file and every `derived_from` ancestor (cycles are an error)
 *   2. deep-merge root → leaf: objects merge key by key, scalars and arrays in
 *      the child REPLACE the parent's. Arrays replace rather than concatenate
 *      because "tier 2 has these parts" must be readable from the tier-2 file
 *      alone; a spec whose part list is scattered across three ancestors is a
 *      spec nobody can review.
 *   3. apply the schema's defaults (ajv `useDefaults`)
 *   4. validate against the JSON Schema, then against the generator registry
 *      (body plan, params, parts, rig, animation generators, palette names)
 *
 * The spec hash is the SHA-256 of the resolved spec as canonical JSON (sorted
 * keys), so a change anywhere in the chain changes every descendant's hash and
 * the build cache does the right thing.
 *
 * Blender never reads YAML. `asset-build` hands it the resolved JSON.
 */

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
export const SPECS_DIR = join(REPO_ROOT, 'art', 'specs')
export const SCHEMA_PATH = join(REPO_ROOT, 'art', 'spec.schema.json')
export const REGISTRY_PATH = join(REPO_ROOT, 'art', 'generators', 'registry.json')

export interface Registry {
  readonly version: string
  readonly palette: Record<string, string>
  readonly palette_aliases: Record<string, string>
  readonly body_plans: Record<string, { class: string; attachments: string[]; slots: string[]; params: Record<string, ParamDef> }>
  readonly parts: Record<string, { attaches: string[]; default_at: string; slots: string[]; triangles: number }>
  readonly rigs: Record<string, { plans: string[]; bones: string[]; ik: string[] }>
  readonly animations: Record<string, { clips: string[]; loop: boolean; params: Record<string, ParamDef> }>
}

export interface ParamDef {
  readonly default: number | string | boolean
  readonly min?: number
  readonly max?: number
  readonly enum?: readonly string[]
}

export interface Problem {
  /** JSON-pointer-ish path into the spec, e.g. `/params/height`. */
  readonly path: string
  readonly message: string
}

export interface Resolved {
  readonly id: string
  readonly spec: AssetSpec
  /** Ancestor ids, nearest first. */
  readonly chain: readonly string[]
  readonly hash: string
  readonly problems: readonly Problem[]
}

type Json = Record<string, unknown>

export function loadRegistry(path = REGISTRY_PATH): Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Registry
}

export function loadSchema(path = SCHEMA_PATH): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json
}

export function specPath(id: string, dir = SPECS_DIR): string {
  return join(dir, `${id}.yaml`)
}

export function listSpecIds(dir = SPECS_DIR): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => basename(f, '.yaml'))
    .sort()
}

/** Raw file contents as parsed YAML, no inheritance, no defaults. */
export function readRawSpec(id: string, dir = SPECS_DIR): Json {
  const p = specPath(id, dir)
  if (!existsSync(p)) throw new Error(`no spec for "${id}" at ${p}`)
  const parsed: unknown = parseYaml(readFileSync(p, 'utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${p}: a spec is a YAML mapping, got ${parsed === null ? 'nothing' : typeof parsed}`)
  }
  return parsed as Json
}

function isPlainObject(v: unknown): v is Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Child wins. Objects merge; everything else replaces. Pure. */
export function mergeSpecs(parent: Json, child: Json): Json {
  const out: Json = { ...parent }
  for (const key of Object.keys(child)) {
    const c = child[key]
    const p = parent[key]
    out[key] = isPlainObject(c) && isPlainObject(p) ? mergeSpecs(p, c) : structuredClone(c)
  }
  return out
}

/**
 * Walk `derived_from` to the root and merge back down. Returns the merged
 * object with `derived_from` set to the immediate parent (kept so the manifest
 * can record lineage) and the chain of ancestor ids.
 */
export function inherit(id: string, dir = SPECS_DIR): { merged: Json; chain: string[] } {
  const chain: string[] = []
  const files: Json[] = []
  let cur: string | undefined = id
  while (cur !== undefined) {
    if (chain.includes(cur) || cur === id && chain.length > 0) {
      throw new Error(`inheritance cycle: ${[id, ...chain, cur].join(' -> ')}`)
    }
    const raw = readRawSpec(cur, dir)
    files.push(raw)
    if (cur !== id) chain.push(cur)
    const next = raw['derived_from']
    if (next !== undefined && typeof next !== 'string') throw new Error(`${cur}: derived_from must be an id`)
    cur = next
  }
  // Root first.
  let merged: Json = {}
  for (let i = files.length - 1; i >= 0; i--) merged = mergeSpecs(merged, files[i] as Json)
  merged['id'] = id
  const parent = chain[0]
  if (parent !== undefined) merged['derived_from'] = parent
  else delete merged['derived_from']
  return { merged, chain }
}

let cachedValidator: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null } | null = null

function validator(schema: Json) {
  if (cachedValidator) return cachedValidator
  const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false })
  addFormats(ajv)
  cachedValidator = ajv.compile(schema)
  return cachedValidator
}

function ajvProblems(errors: ErrorObject[] | null | undefined): Problem[] {
  if (!errors) return []
  return errors.map((e) => {
    const extra = e.keyword === 'additionalProperties' ? ` (${String((e.params as { additionalProperty: string }).additionalProperty)})`
      : e.keyword === 'enum' ? ` (one of ${JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues)})`
      : ''
    return { path: e.instancePath || '/', message: `${e.message ?? e.keyword}${extra}` }
  })
}

/** Checks the schema cannot express: names must exist in the registry, params in range. */
export function registryProblems(spec: AssetSpec, reg: Registry): Problem[] {
  const out: Problem[] = []
  const planName = spec.body_plan ?? 'imported'
  const plan = reg.body_plans[planName]
  if (!plan) {
    out.push({ path: '/body_plan', message: `unknown body plan "${planName}"; registry has ${Object.keys(reg.body_plans).join(', ')}` })
  } else {
    if (plan.class !== 'any' && plan.class !== spec.class) {
      out.push({ path: '/body_plan', message: `"${spec.body_plan}" is a ${plan.class} plan, and this is a ${spec.class}` })
    }
    const params: Record<string, unknown> = spec.params ?? {}
    for (const [k, v] of Object.entries(params)) {
      if (k === 'parts') continue
      const def = plan.params[k]
      if (!def) {
        out.push({ path: `/params/${k}`, message: `"${spec.body_plan}" has no parameter "${k}"; it has ${Object.keys(plan.params).join(', ') || 'none'}` })
        continue
      }
      if (def.enum) {
        if (typeof v !== 'string' || !def.enum.includes(v)) out.push({ path: `/params/${k}`, message: `must be one of ${def.enum.join(', ')}` })
      } else if (typeof def.default === 'number') {
        if (typeof v !== 'number') out.push({ path: `/params/${k}`, message: 'must be a number' })
        else if (def.min !== undefined && v < def.min) out.push({ path: `/params/${k}`, message: `${v} is below the minimum ${def.min}` })
        else if (def.max !== undefined && v > def.max) out.push({ path: `/params/${k}`, message: `${v} is above the maximum ${def.max}` })
      } else if (typeof def.default === 'boolean' && typeof v !== 'boolean') {
        out.push({ path: `/params/${k}`, message: 'must be true or false' })
      }
    }
    const parts = (params as { parts?: unknown[] }).parts ?? []
    parts.forEach((p, i) => {
      const name = typeof p === 'string' ? p : (p as { part: string }).part
      const at = typeof p === 'string' ? undefined : (p as { at?: string }).at
      const def = reg.parts[name]
      if (!def) {
        out.push({ path: `/params/parts/${i}`, message: `unknown part "${name}"` })
        return
      }
      const point = at ?? def.default_at
      if (!def.attaches.includes(point)) out.push({ path: `/params/parts/${i}`, message: `"${name}" cannot attach at "${point}"; it attaches at ${def.attaches.join(', ')}` })
      else if (spec.body_plan !== 'imported' && !plan.attachments.includes(point)) out.push({ path: `/params/parts/${i}`, message: `"${spec.body_plan}" has no attachment point "${point}"; it has ${plan.attachments.join(', ')}` })
    })
    for (const slot of spec.palette?.team_mask ?? []) {
      const known = new Set<string>(plan.slots)
      for (const p of parts) {
        const def = reg.parts[typeof p === 'string' ? p : (p as { part: string }).part]
        if (def) for (const s of def.slots) known.add(s)
      }
      if (spec.body_plan !== 'imported' && !known.has(slot)) out.push({ path: '/palette/team_mask', message: `no material slot "${slot}" on this body plan or its parts; slots are ${[...known].join(', ')}` })
    }
  }
  if (spec.rig !== null && spec.rig !== undefined) {
    const rig = reg.rigs[spec.rig]
    if (!rig) out.push({ path: '/rig', message: `unknown rig "${spec.rig}"; registry has ${Object.keys(reg.rigs).join(', ')}` })
    else if (planName !== 'imported' && !rig.plans.includes(planName)) out.push({ path: '/rig', message: `rig "${spec.rig}" fits ${rig.plans.join(', ')}, not "${planName}"` })
  }
  const pal = spec.palette ?? {}
  for (const role of ['primary', 'secondary', 'accent', 'glow'] as const) {
    const name = pal[role]
    if (name === undefined || name === null) continue
    if (!(name in reg.palette) && !(name in reg.palette_aliases)) out.push({ path: `/palette/${role}`, message: `"${name}" is not a palette colour; see docs/art/style-sheet.md §3` })
  }
  for (const [clip, anim] of Object.entries(spec.animations ?? {})) {
    const gen = reg.animations[anim.gen]
    const extra: Record<string, unknown> = anim
    if (!gen) {
      out.push({ path: `/animations/${clip}/gen`, message: `unknown animation generator "${anim.gen}"` })
      continue
    }
    if (!gen.clips.includes(clip)) out.push({ path: `/animations/${clip}/gen`, message: `"${anim.gen}" produces ${gen.clips.join('/')}, not ${clip}` })
    for (const [k, v] of Object.entries(extra)) {
      if (k === 'gen' || k === 'markers' || k === 'duration' || k === 'stride') continue
      const def = gen.params[k]
      if (!def) { out.push({ path: `/animations/${clip}/${k}`, message: `"${anim.gen}" has no parameter "${k}"; it has ${Object.keys(gen.params).join(', ')}` }); continue }
      if (def.enum) { if (typeof v !== 'string' || !def.enum.includes(v)) out.push({ path: `/animations/${clip}/${k}`, message: `must be one of ${def.enum.join(', ')}` }) }
      else if (typeof def.default === 'number' && typeof v === 'number') {
        if (def.min !== undefined && v < def.min) out.push({ path: `/animations/${clip}/${k}`, message: `${v} is below the minimum ${def.min}` })
        if (def.max !== undefined && v > def.max) out.push({ path: `/animations/${clip}/${k}`, message: `${v} is above the maximum ${def.max}` })
      }
    }
  }
  if (spec.source.licence === 'other' || spec.source.kind === 'ai' || spec.source.kind === 'freelance') {
    if (!spec.source.terms) out.push({ path: '/source/terms', message: `a ${spec.source.kind} / ${spec.source.licence} source must record its terms` })
  }
  if (spec.source.kind === 'ai' && !spec.source.service) out.push({ path: '/source/service', message: 'an ai source must name the service' })
  return out
}

/**
 * A body-plan parameter by name. The generated type closes `params` to the
 * fields the schema names (so a typo in a NAMED field is a compile error), and
 * generator parameters are read through this instead of an index signature.
 */
export function param(spec: AssetSpec, name: string): unknown {
  return (spec.params as Record<string, unknown> | undefined)?.[name]
}

/** Canonical JSON: sorted keys at every level, so the hash is stable. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (isPlainObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}

export function hashSpec(spec: unknown): string {
  return createHash('sha256').update(canonical(spec)).digest('hex').slice(0, 16)
}

export interface ResolveOptions {
  readonly dir?: string
  readonly schema?: Json
  readonly registry?: Registry
}

/**
 * The whole thing. Never throws for a bad spec -- problems come back in the
 * result so a tool can list every one. Throws only for a missing file or a
 * cycle, which are not things to list alongside "height is too big".
 */
export function resolveSpec(id: string, opts: ResolveOptions = {}): Resolved {
  const dir = opts.dir ?? SPECS_DIR
  const problems: Problem[] = []
  // The filename is the id. A file whose `id:` says otherwise is the kind of
  // mistake that survives a copy-paste for months, so it is a problem, not a
  // silent override.
  const declared = readRawSpec(id, dir)['id']
  if (declared !== id) problems.push({ path: '/id', message: `file is ${id}.yaml but id says ${JSON.stringify(declared)}` })
  const { merged, chain } = inherit(id, dir)
  const validate = validator(opts.schema ?? loadSchema())
  const ok = validate(merged)
  if (!ok) problems.push(...ajvProblems(validate.errors))
  const spec = merged as unknown as AssetSpec
  if (ok) problems.push(...registryProblems(spec, opts.registry ?? loadRegistry()))
  return { id, spec, chain, hash: hashSpec(merged), problems }
}
