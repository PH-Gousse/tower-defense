# The asset spec

*Generated from `art/spec.schema.json` by `pnpm spec-types`. Do not edit; edit the schema.*

One asset, fully described. Everything needed to regenerate it from art/generators at a commit. Fields not listed here are rejected. Every field has a default except id, class, archetype and source.

## Fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `spec_version` | integer 1.. | `1` | Format version of this file. Bumped when a field changes meaning; the resolver refuses a version it does not know. |
| `id` | string | **required** | The asset id: the filename, the manifest key, the glTF scene name and the TypeScript identifier. Never changes. |
| `class` | `creep` \| `tower` \| `projectile` \| `effect` \| `tile` \| `prop` | **required** | Asset class. Decides the budget row, the required clips and the id pattern. |
| `archetype` | string | **required** | The game archetype (swarm, runner, tank; single, splash, slow) or, for the other classes, a free label used in lineups. |
| `tier` | integer 1..3 | — | Creep tier 1 to 3. Tier 1 is the sim's tier index 0. |
| `level` | integer 1..3 | — | Tower level 1 to 3. |
| `derived_from` | string | — | Id of the spec this one inherits from. Inheritance is a deep merge: objects merge key by key, scalars and arrays in this spec replace the parent's. Chains resolve recursively; cycles are an error. |
| `body_plan` | string | `"imported"` | A body plan from art/generators/registry.json, or "imported" for an external model. |
| `params` | object | `{}` | Body-plan parameters. Names, defaults and ranges come from the registry; spec-validate checks them. `parts` is the list of part-library pieces to attach, each a name or {part, at, scale}. |
| `params.parts` | array of any | `[]` |  |
| `palette` | object | `{}` | Colour roles, each a palette name from the style sheet (or an alias like creep_skin_2). |
| `palette.primary` | string | `"stone"` |  |
| `palette.secondary` | string | `"stone_dark"` |  |
| `palette.accent` | string | `"danger"` |  |
| `palette.glow` | string \| null | `null` | Emissive colour for glow-slot geometry (eyes, crystals). Null for none. |
| `palette.tier_shift` | number 0..1 | `0` | Fraction the primary is blended toward the accent. The style sheet's tier language sets 0 / 0.25 / 0.5. |
| `palette.trim` | boolean | `false` | Whether the gold tier-3 trim and emissive strip are present. |
| `palette.team_mask` | array of string | `[]` | Material slots painted white in the team-colour mask. Slot names come from the body plan and parts. |
| `rig` | string \| null | `null` | Rig template from the registry, or null for an unrigged asset (projectiles, effects, tiles, props). |
| `animations` | object | `{}` | Clip name (from the animation contract) to the animation generator that produces it, with its parameters. |
| `audio` | object | `{}` | Event name to sound id. Events not listed fall back to the archetype's default in the binding table. |
| `game` | object | `{}` | PROPOSED game-data entry. Never applied by the factory; handed to /rule-change. Free-form, keyed like the constants file. |
| `import` | object | — | Only when body_plan is "imported": where the external model is and how to bring it to the conventions. |
| `import.file` | string | — | Path under art/source/ (.glb, .gltf, .fbx, .blend). |
| `import.scale` | number 0.. | `0` | Multiplier applied before fitting to the class's height range. 0 means fit automatically. |
| `import.forward` | `+x` \| `-x` \| `+y` \| `-y` \| `+z` \| `-z` | `"+z"` | Which axis of the source file faces forward. |
| `import.up` | `+y` \| `+z` | `"+y"` |  |
| `import.retarget` | string \| null | `null` | Rig template to retarget the file's own clips onto, or null to bake procedural clips from `animations` onto the file's rig. |
| `import.clip_map` | object | `{}` | Source clip name to contract clip name, for files that carry their own animation. |
| `source` | object | **required** | Provenance and licence. Required; the gate refuses a build without it. |
| `source.kind` | `generated` \| `pack` \| `ai` \| `freelance` \| `hand` | — |  |
| `source.licence` | `own` \| `cc0` \| `cc-by` \| `other` | — |  |
| `source.author` | string | `"asset-factory"` |  |
| `source.url` | string | `""` |  |
| `source.attribution` | string | `""` | Required for cc-by: the exact line that goes in LICENSES.md. |
| `source.service` | string | `""` | For ai and paid sources: the service or vendor. |
| `source.terms` | string | `""` | For ai, paid and other: a pointer to the terms. |
| `source.approved_by` | string | `""` | Required before an ai, freelance or other-licence asset ships. |
| `source.approved_on` | string | `""` |  |
| `source.notes` | string | `""` |  |

## Inheritance

`derived_from` names a parent spec. Resolution walks to the root and merges back down: objects merge key by key, scalars and arrays in the child **replace** the parent's. Arrays replace rather than concatenate so a tier-2 spec's part list is readable from the tier-2 file alone. The resolved spec is what the builder, the gate and the manifest see; `spec-validate --print <id>` shows it.

## Class rules

- A **creep** needs `tier`, a `body_plan` and a `rig`; `level` is an error.
- A **tower** needs `level`, a `body_plan` and a `rig`; `tier` is an error.
- A **projectile, effect, tile or prop** has neither `tier` nor `level`, and `rig` is null.
- `body_plan: imported` needs `import.file`.
- `licence: cc-by` needs `source.attribution`; `kind: ai` needs `source.service` and `source.terms`; `kind: ai`, `freelance` or `licence: other` need `source.approved_by` before the asset ships (the gate checks the last one, the validator the rest).

## Beyond the schema

`spec-validate` also checks the generator registry (`art/generators/registry.json`): the body plan exists and matches the class, every `params` name exists on that plan and is in range, every part exists and attaches at a point the plan has, every `team_mask` slot exists on the plan or a part, the rig fits the plan, every animation generator exists and produces that clip, and every palette name is in the style sheet.

## Example

```yaml
# Runner, tier 2: the same hound, a tenth bigger, shoulder spikes, palette a
# quarter of the way to the accent. Nothing else changes -- see the style
# sheet's tier language. Inherits creep_runner_t1.
id: creep_runner_t2
class: creep
archetype: runner
tier: 2
derived_from: creep_runner_t1
params:
  height: 0.605
  body_length: 0.55
  parts: [shoulder_spikes]
palette:
  tier_shift: 0.25
game:
  hp: 200
  cost: 1250
source:
  kind: generated
  licence: own
```
