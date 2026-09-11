# tools/art

The pipeline scripts, one pnpm alias each. TypeScript, run with vite-node;
each prints a human summary and one JSON line last, exits non-zero on
failure (2 for a usage or missing-tool problem), and says how to install
what it lacks.

| Alias | Does |
|---|---|
| `pnpm spec-validate <id\|all> [--print]` | schema, defaults, inheritance, registry names. No Blender. |
| `pnpm spec-types` | regenerate the spec's TypeScript type and `docs/art/spec.md` from the schema |
| `pnpm asset-build <id\|all> [--force] [--dry-run] [--preview]` | resolved spec → headless Blender → `assets/raw/`; cached by spec hash + generator version |
| `pnpm asset-gate <id\|all> [--changed]` | budgets and the animation contract; on pass meshopt + KTX2 → `assets/build/`, manifest, `LICENSES.md` |
| `pnpm asset-preview <id\|all>` | turntable, 32 px silhouettes, clip strips, team A/B, game-distance, lineup → `reports/art/<id>/` |
| `pnpm asset-preview --lineup <class>` | every admitted asset of a class in one strip at true relative scale → `reports/art/lineup_<class>.png` |
| `pnpm asset-critique <id>` | the measurable half of the critique plus the scaffold the art-director fills |
| `pnpm asset-report` | `reports/art/index.html`: catalogue, budgets, staleness, licences |
| `pnpm audio-synth <sfx_id\|all> [--force]` | `art/sounds/<id>.yaml` → synthesised, normalised, `assets/build/sfx/<id>.webm` + `.mp3`, manifest |
| `pnpm audio-import <file> --as <id> --event <e> --kind <k> --licence <l> …` | an external sound through the same normalisation and manifest |
| `pnpm manifest-types` | `packages/client/src/assets/manifest.generated.ts`: typed asset and sound ids |
| `pnpm asset-regen [--all]` | rebuild what is stale (or everything), gate, re-preview, and report which assets changed visually with before/after strips |
| `pnpm asset-retire <id>` | remove from the manifest and build, move the spec to `art/specs/retired/`; refuses on a dangling reference |
| `pnpm game-proposal <id\|all>` | the spec's `game:` block as a constants patch, GDD stub and test list in `reports/art/<id>/game-proposal/`; applied only by `/rule-change` |

`lib/` holds what they share: the spec resolver, the GLB reader, the
budgets (mirroring the style sheet, pinned by a test), the manifest writer,
the Blender runner, the audio synthesiser and ffmpeg pipeline.

`docs/art/pipeline.md` is the reader's guide.
