---
name: asset-gate
description: Run the admission gate on one asset or all, and explain every rejection in plain language with the fix. Never relaxes a budget or edits the build directory.
disable-model-invocation: false
argument-hint: "[id | all]"
allowed-tools: Read Grep Glob Bash(pnpm asset-gate*) Bash(pnpm asset-build*) Bash(pnpm spec-validate*) Bash(pnpm asset-report*)
---

# /asset-gate

```sh
pnpm asset-gate <id|all>
```

Read the JSON line. For every rejected asset, translate each violation for the owner:

| Code | Means | The fix is |
|---|---|---|
| `StaleBuild` | the raw build predates the spec or the generator | `pnpm asset-build <id>` |
| `NotBuilt` | no raw file | `pnpm asset-build <id>` |
| `OverTriangleBudget` | too many triangles for the class | fewer segments on round primitives, fewer parts, smaller bevels; `--dry-run` shows the estimate |
| `TooManyTextures` / `TextureTooLarge` | the one-texture rule | the builder sizes by class; an import must be re-baked |
| `OverBoneBudget` | rig too large for the class | a smaller rig template |
| `MissingClip` / `UnknownClip` | the animation contract's names | add the clip to `animations:`; names are exact |
| `ClipLength` / `OffGrid` | contract timing | `duration` or `cadence` in the spec; imports need 24 fps sampling |
| `LoopSeam` / `RootMotion` | a loop that does not close or walks away | a generator bug or an imported cycle that is not a cycle |
| `NotGrounded` / `OffCentre` / `Scale` / `Footprint` | origin and size rules (§8, §4) | `params.height`, `import.scale`; a tower stays inside 0.84 |
| `UnknownMaterial` / `AlphaMode` / `NoAlbedo` | the two-material rule | re-materialled by the builder; an import must go through it |
| `NoTeamMask` / `TeamMaskCoverage` | the owner colour has nowhere to land, or too much | `palette.team_mask` slots |
| `NeedsSignOff` / `NoLicence` / `NoAttribution` | provenance | `source.*` in the spec |
| `OverFileBudget` | too large after compression | fewer triangles or shorter clips |

Then say what the owner should do next, in one line per asset. Never suggest changing a
number in `tools/art/lib/budgets.ts`; that is `/style-sheet` and a decision.

## Finish by printing

```
GATE:      <n> admitted · <n> unchanged · <n> rejected
REJECTED:  <id>: <code> — <plain-language fix>   (one line each)
NEXT:      <the command to run, or "nothing: all admitted">
```
