import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compile } from 'json-schema-to-typescript'
import { REPO_ROOT, loadSchema } from './spec'

/**
 * `art/spec.schema.json` is the source of truth for the spec format. This
 * derives two things from it and writes them into the tree:
 *
 *   tools/art/lib/spec.generated.ts   the TypeScript type every tool uses
 *   docs/art/spec.md                  the field reference a person reads
 *
 * Both are committed, and a test regenerates them into memory and fails if the
 * committed copy differs -- so the schema cannot move without the type and the
 * doc moving with it. Run `pnpm spec-types` after editing the schema.
 */

export const TYPES_PATH = join(REPO_ROOT, 'tools', 'art', 'lib', 'spec.generated.ts')
export const DOC_PATH = join(REPO_ROOT, 'docs', 'art', 'spec.md')

/**
 * The schema uses typed `additionalProperties` for generator parameters
 * ("any other key is a number, string or boolean") and `allOf`/`if` for the
 * per-class rules. Both are right for validation and wrong for a TypeScript
 * type: an index signature next to named optional properties is a TS2411
 * error, and the conditionals compile to an `{[k: string]: unknown}`
 * intersection that hides every field. So the type is generated from a copy
 * with those stripped -- closed objects, named fields only -- and the code
 * reads free-form generator parameters through `Object.entries`, which is
 * what it does anyway.
 */
function forTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(forTypes)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  const o = node as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (k === 'allOf' || k === 'propertyNames') continue
    if (k === 'additionalProperties' && 'properties' in o && typeof v === 'object') continue
    out[k] = forTypes(v)
  }
  return out
}

export async function generateTypes(): Promise<string> {
  const schema = forTypes(loadSchema())
  const ts = await compile(schema as never, 'AssetSpec', {
    bannerComment: '/* Generated from art/spec.schema.json by `pnpm spec-types`. Do not edit. */',
    additionalProperties: false,
    style: { semi: false, singleQuote: true, printWidth: 110 },
  })
  return ts
}

interface Prop {
  description?: string
  type?: string | string[]
  enum?: unknown[]
  default?: unknown
  pattern?: string
  minimum?: number
  maximum?: number
  properties?: Record<string, Prop>
  additionalProperties?: unknown
  items?: Prop
  propertyNames?: { enum?: string[] }
}

function typeOf(p: Prop): string {
  if (p.enum) return p.enum.map((e) => `\`${String(e)}\``).join(' \\| ')
  const t = Array.isArray(p.type) ? p.type.join(' \\| ') : (p.type ?? 'any')
  if (t === 'array' && p.items) return `array of ${typeOf(p.items)}`
  return t
}

function rows(props: Record<string, Prop>, required: string[], prefix = ''): string[] {
  const out: string[] = []
  for (const [name, p] of Object.entries(props)) {
    const key = `${prefix}${name}`
    const req = required.includes(name) ? '**required**' : p.default === undefined ? '—' : `\`${JSON.stringify(p.default)}\``
    const range = p.minimum !== undefined || p.maximum !== undefined ? ` ${p.minimum ?? ''}..${p.maximum ?? ''}` : ''
    const desc = (p.description ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
    out.push(`| \`${key}\` | ${typeOf(p)}${range} | ${req} | ${desc} |`)
    if (p.properties) out.push(...rows(p.properties, [], `${key}.`))
  }
  return out
}

export function generateDoc(): string {
  const schema = loadSchema() as unknown as Prop & { required: string[]; description: string; allOf?: { if: unknown; then: unknown }[] }
  const lines = [
    '# The asset spec',
    '',
    '*Generated from `art/spec.schema.json` by `pnpm spec-types`. Do not edit; edit the schema.*',
    '',
    schema.description,
    '',
    '## Fields',
    '',
    '| Field | Type | Default | Meaning |',
    '|---|---|---|---|',
    ...rows(schema.properties ?? {}, schema.required),
    '',
    '## Inheritance',
    '',
    '`derived_from` names a parent spec. Resolution walks to the root and merges back down: objects merge key by key, scalars and arrays in the child **replace** the parent\'s. Arrays replace rather than concatenate so a tier-2 spec\'s part list is readable from the tier-2 file alone. The resolved spec is what the builder, the gate and the manifest see; `spec-validate --print <id>` shows it.',
    '',
    '## Class rules',
    '',
    '- A **creep** needs `tier`, a `body_plan` and a `rig`; `level` is an error.',
    '- A **tower** needs `level`, a `body_plan` and a `rig`; `tier` is an error.',
    '- A **projectile, effect, tile or prop** has neither `tier` nor `level`, and `rig` is null.',
    '- `body_plan: imported` needs `import.file`.',
    '- `licence: cc-by` needs `source.attribution`; `kind: ai` needs `source.service` and `source.terms`; `kind: ai`, `freelance` or `licence: other` need `source.approved_by` before the asset ships (the gate checks the last one, the validator the rest).',
    '',
    '## Beyond the schema',
    '',
    '`spec-validate` also checks the generator registry (`art/generators/registry.json`): the body plan exists and matches the class, every `params` name exists on that plan and is in range, every part exists and attaches at a point the plan has, every `team_mask` slot exists on the plan or a part, the rig fits the plan, every animation generator exists and produces that clip, and every palette name is in the style sheet.',
    '',
    '## Example',
    '',
    '```yaml',
    readFileSync(join(REPO_ROOT, 'art', 'specs', 'creep_runner_t2.yaml'), 'utf8').trimEnd(),
    '```',
    '',
  ]
  return lines.join('\n')
}
