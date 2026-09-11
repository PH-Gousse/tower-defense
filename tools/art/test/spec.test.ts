import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mergeSpecs, inherit, resolveSpec, hashSpec, canonical, listSpecIds, loadRegistry, loadSchema, param,
} from '../lib/spec'
import { generateTypes, generateDoc, TYPES_PATH, DOC_PATH } from '../lib/generate'

/** A throwaway spec directory. */
function specDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ltw-specs-'))
  for (const [id, yaml] of Object.entries(files)) writeFileSync(join(dir, `${id}.yaml`), yaml)
  return dir
}

const BASE = `
id: creep_runner_t1
class: creep
archetype: runner
tier: 1
body_plan: quadruped
params: { height: 0.55, head: hound }
palette: { primary: creep_skin_2, accent: danger, team_mask: [torso_stripe] }
rig: quadruped
animations:
  Walk: { gen: walk_quadruped, stride: 0.9 }
  Death: { gen: collapse_forward }
source: { kind: generated, licence: own }
`

describe('inheritance', () => {
  it('a child overrides scalars and arrays, and merges objects key by key', () => {
    const merged = mergeSpecs(
      { a: 1, list: [1, 2], obj: { x: 1, y: 2 } },
      { a: 2, list: [3], obj: { y: 3, z: 4 } },
    )
    expect(merged).toEqual({ a: 2, list: [3], obj: { x: 1, y: 3, z: 4 } })
  })

  it('an evolution spec is small: it inherits the parent and overrides what changed', () => {
    const dir = specDir({
      creep_runner_t1: BASE,
      creep_runner_t2: `
id: creep_runner_t2
class: creep
archetype: runner
tier: 2
derived_from: creep_runner_t1
params: { height: 0.605, parts: [shoulder_spikes] }
palette: { tier_shift: 0.25 }
source: { kind: generated, licence: own }
`,
    })
    const r = resolveSpec('creep_runner_t2', { dir })
    expect(r.problems).toEqual([])
    expect(r.chain).toEqual(['creep_runner_t1'])
    expect(param(r.spec, 'height')).toBe(0.605)
    expect(param(r.spec, 'head')).toBe('hound')             // inherited
    expect(r.spec.palette?.primary).toBe('creep_skin_2')    // inherited
    expect(r.spec.palette?.tier_shift).toBe(0.25)
    expect(r.spec.rig).toBe('quadruped')
    expect(r.spec.derived_from).toBe('creep_runner_t1')
  })

  it('a cycle is an error, not a hang', () => {
    const dir = specDir({
      creep_a_t1: `{ id: creep_a_t1, class: creep, archetype: a, tier: 1, derived_from: creep_b_t1, body_plan: blob, rig: blob, source: { kind: generated, licence: own } }`,
      creep_b_t1: `{ id: creep_b_t1, class: creep, archetype: b, tier: 1, derived_from: creep_a_t1, body_plan: blob, rig: blob, source: { kind: generated, licence: own } }`,
    })
    expect(() => inherit('creep_a_t1', dir)).toThrow(/cycle/)
  })

  it('a change in the parent changes the child hash', () => {
    const dir = specDir({ creep_runner_t1: BASE, creep_runner_t2: `{ id: creep_runner_t2, class: creep, archetype: runner, tier: 2, derived_from: creep_runner_t1, source: { kind: generated, licence: own } }` })
    const before = resolveSpec('creep_runner_t2', { dir }).hash
    writeFileSync(join(dir, 'creep_runner_t1.yaml'), BASE.replace('height: 0.55', 'height: 0.6'))
    const after = resolveSpec('creep_runner_t2', { dir }).hash
    expect(after).not.toBe(before)
  })
})

describe('defaults', () => {
  it('every optional field is filled from the schema, so the builder never sees undefined', () => {
    const dir = specDir({ creep_runner_t1: BASE })
    const { spec } = resolveSpec('creep_runner_t1', { dir })
    expect(spec.spec_version).toBe(1)
    expect(spec.palette?.secondary).toBe('stone_dark')
    expect(spec.palette?.tier_shift).toBe(0)
    expect(spec.palette?.trim).toBe(false)
    expect(spec.source.author).toBe('asset-factory')
    expect(spec.audio).toEqual({})
    expect(spec.game).toEqual({})
  })
})

describe('validation', () => {
  it('lists every problem rather than stopping at the first', () => {
    const dir = specDir({
      creep_runner_t1: BASE
        .replace('height: 0.55', 'height: 9')                // out of range
        .replace('head: hound', 'head: dragon')              // not in enum
        .replace('accent: danger', 'accent: magenta')        // not a palette colour
        .replace('gen: collapse_forward', 'gen: explode'),   // unknown generator
    })
    const r = resolveSpec('creep_runner_t1', { dir })
    const paths = r.problems.map((p) => p.path)
    expect(paths).toContain('/params/height')
    expect(paths).toContain('/params/head')
    expect(paths).toContain('/palette/accent')
    expect(paths).toContain('/animations/Death/gen')
    expect(r.problems.length).toBe(4)
  })

  it('a creep must not carry a level, and a tower must not carry a tier', () => {
    const dir = specDir({ creep_runner_t1: BASE + '\nlevel: 2\n' })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.some((p) => p.path === '/level')).toBe(true)
  })

  it('an unknown field is rejected, so a typo cannot silently do nothing', () => {
    const dir = specDir({ creep_runner_t1: BASE + '\nanimation: {}\n' })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.some((p) => p.message.includes('animation'))).toBe(true)
  })

  it('a part must attach at a point the body plan has', () => {
    const dir = specDir({ creep_runner_t1: BASE.replace('params: { height: 0.55, head: hound }', 'params: { parts: [{ part: extra_barrel }] }') })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.some((p) => p.path === '/params/parts/0')).toBe(true)
  })

  it('the filename is the id; a file that says otherwise is a problem, not an override', () => {
    const dir = specDir({ creep_runner_t1: BASE.replace('id: creep_runner_t1', 'id: creep_runner_t2') })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.some((p) => p.path === '/id' && p.message.includes('creep_runner_t2'))).toBe(true)
  })

  it('an id must follow the naming rule', () => {
    const dir = specDir({ 'Runner-2': BASE.replace('id: creep_runner_t1', 'id: Runner-2') })
    const r = resolveSpec('Runner-2', { dir })
    expect(r.problems.some((p) => p.path === '/id')).toBe(true)
  })

  it('an AI-generated source must name its service and terms', () => {
    const dir = specDir({ creep_runner_t1: BASE.replace('source: { kind: generated, licence: own }', 'source: { kind: ai, licence: other }') })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.map((p) => p.path)).toEqual(expect.arrayContaining(['/source/service', '/source/terms']))
  })

  it('an imported body plan needs a file', () => {
    const dir = specDir({ creep_runner_t1: BASE.replace('body_plan: quadruped', 'body_plan: imported').replace('rig: quadruped', 'rig: quadruped') })
    const r = resolveSpec('creep_runner_t1', { dir })
    expect(r.problems.some((p) => p.message.includes('import'))).toBe(true)
  })
})

describe('hashing', () => {
  it('canonical JSON sorts keys at every level', () => {
    expect(canonical({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] })).toBe('{"a":[3,{"y":2,"z":1}],"b":{"c":2,"d":1}}')
    expect(hashSpec({ a: 1, b: 2 })).toBe(hashSpec({ b: 2, a: 1 }))
  })
})

describe('the committed catalogue', () => {
  it('every spec in art/specs validates', () => {
    const schema = loadSchema()
    const registry = loadRegistry()
    for (const id of listSpecIds()) {
      const r = resolveSpec(id, { schema, registry })
      expect(r.problems, `${id}: ${r.problems.map((p) => `${p.path} ${p.message}`).join('; ')}`).toEqual([])
    }
  })

  it('the registry palette matches the style sheet', () => {
    const reg = loadRegistry()
    const sheet = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'art', 'style-sheet.md'), 'utf8')
    for (const [name, hex] of Object.entries(reg.palette)) {
      expect(sheet, `${name} ${hex} is not in the style sheet`).toMatch(new RegExp(`\`${name}\`[^\\n]*\`${hex}\``))
    }
  })
})

describe('generated files', () => {
  it('spec.generated.ts matches the schema (run `pnpm spec-types` if this fails)', async () => {
    expect(readFileSync(TYPES_PATH, 'utf8')).toBe(await generateTypes())
  })
  it('docs/art/spec.md matches the schema (run `pnpm spec-types` if this fails)', () => {
    expect(readFileSync(DOC_PATH, 'utf8')).toBe(generateDoc())
  })
})
