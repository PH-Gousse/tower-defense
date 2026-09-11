# The asset pipeline

How an asset gets from a one-line request to the game, written for someone who has never
opened this repository: a contributor, a freelancer, or a future session of the tooling.

## 1. The idea

**Assets are generated from specs.** Nobody sculpts. A file in `art/specs/<id>.yaml`
describes an asset (its body plan, its parameters, its parts, its palette, its rig, its
clips), and a library of parametric generators running inside Blender builds it. Every
asset in the game is reproducible from its spec plus the generator library at a commit.
"Evolve the runner into tier 2" is a spec that inherits the tier-1 spec and overrides a
few parameters, not a new model.

Externally made models (a CC0 pack, an AI generator, a freelancer's `.blend`) enter the
same system through the `imported` body plan: they get a spec, are scaled and oriented to
the conventions, re-materialled to the palette, given a team mask, retargeted or given
procedural clips, and then pass the same gate and the same previews as everything else.

`assets/build/` is a **cache** of that fact. It is never edited by hand; a hook rejects
the attempt.

## 2. Layout

```
art/
  references/        moodboard and sketches. Nothing from Warcraft, ever.
  specs/             one YAML per asset — the source of truth
  generators/        Blender Python: body plans, parts, rigs, animations, materials
  source/            .blend files for hand-made or imported assets
  scripts/           headless Blender entry points and helpers
assets/
  raw/               generator or external output, exactly as produced
  build/             gate output only; never edited by hand
  manifest.json      generated; the client reads this
  LICENSES.md        generated from the manifest
reports/art/         previews, critiques, validation reports (gitignored)
tools/art/           the pipeline scripts, one pnpm alias each
docs/art/            this file, the style sheet, the animation contract, audio
```

## 3. The flow, one asset

```
request ─▶ spec ─▶ spec-validate ─▶ asset-build ─▶ asset-preview ─▶ critique ─┐
                                        ▲                                       │
                                        └──────── change parameters ◀── fail ───┤
                                                                                │ pass
                       asset-gate ─▶ assets/build + manifest ─▶ binding table ◀─┘
                            │
                            └─▶ audio placeholder ─▶ game-data proposal ─▶ /rule-change
```

1. **Spec.** Written by hand or by the `/asset new` skill. Small; every field has a
   default (`docs/art/spec.md`, generated from the schema).
2. **`spec-validate`.** Schema, defaults, inheritance, and that every generator, part,
   rig, clip generator and palette name it references exists. Fast, no Blender.
3. **`asset-build`.** Resolves the spec and runs the generators in headless Blender. Output
   to `assets/raw/<id>.glb` plus a build log. Cached by spec hash and generator version.
4. **`asset-preview`.** Turntable at the game camera, 32 px silhouettes, a contact sheet
   per clip, a team-colour A/B, and a lineup beside tier siblings and archetype peers.
5. **Critique.** The art-director subagent looks at the previews and writes
   `reports/art/<id>/critique.md` against the style sheet, with concrete parameter
   changes. The builder applies them and goes round again, up to a limit.
6. **`asset-gate`.** Budgets and the animation contract, every violation listed, no
   auto-fix, no relaxing. On pass: normalise, resample to 24 fps, compress (meshopt),
   KTX2 the textures, write `assets/build/`, update the manifest.
7. **Wiring.** A row in the client's event binding table; a placeholder sound for every
   event the asset introduces; and `game-proposal`, which writes the spec's `game:` block as
   a constants patch, a GDD stub marked `[proposed]` and the Vitest cases that would pin the
   unit, then stops. `/rule-change` is the only thing that applies any of it. A creep tier
   has no constants of its own (the roster is base × growth^tier), so a tier spec whose
   numbers disagree is reported as a question about the growth rule, not patched.
8. **Review.** The lineup render and the critique are shown for approval. An asset is
   never presented as done without its previews.

## 4. Rules a contributor must know

- **The gate never bends.** If your asset fails a budget, the asset changes.
- **Never edit `assets/build/` or `assets/manifest.json`.** Rebuild instead.
- **Never edit balance constants, the sim, or the GDD from art work.** The factory
  *proposes* a `game:` block; `/rule-change` is the only thing that applies it.
- **Every spec edit is followed by `spec-validate`.** A hook runs it for you.
- **A licence line is mandatory.** No licence, no build. Paid, AI-generated or freelance
  sources need sign-off recorded in the spec before they ship.
- **Determinism.** The same spec at the same generator version produces the same bytes.
  Any randomness is seeded from the spec id. If two builds differ, that is a bug.
- **Interactive Blender is allowed** (with or without the Blender MCP connection), but its
  output is a `.blend` in `art/source/` that goes through `import`, never straight to
  build.

## 5. Commands

| | |
|---|---|
| `pnpm spec-validate <id\|all>` | check specs |
| `pnpm asset-build <id\|all> [--changed] [--dry-run]` | run generators |
| `pnpm asset-gate <id\|all>` | admit or reject; writes `assets/build/` |
| `pnpm asset-preview <id\|all>` | renders to `reports/art/<id>/` |
| `pnpm asset-critique <id>` | scaffold a critique (the subagent fills it) |
| `pnpm asset-report` | the catalogue page |
| `pnpm audio-synth <sfx_id>` / `pnpm audio-import <file> --as <sfx_id>` | sounds |
| `pnpm manifest-types` | TypeScript types from the manifest |
| `pnpm game-proposal <id\|all>` | the `game:` block as a constants patch, a GDD stub and a test list under `reports/art/<id>/game-proposal/`; never applied here |

Every tool prints a human summary and one JSON line last, and exits non-zero on failure.
Each checks its own dependencies and says how to install what is missing.

Skills: `/asset new|evolve|import|source|review|regen|retire|audio|status`,
`/style-sheet`, `/asset-gate`. See `.claude/skills/`.

## 6. Compression and textures

- **Geometry: meshopt** (`EXT_meshopt_compression`) via `gltf-transform`. Chosen over
  Draco because Draco does not compress animation data and its decoder is ten times the
  size; meshopt compresses vertex, index *and* animation streams and its decoder is a
  30 KB WASM already in three.js.
- **Textures: KTX2** with UASTC for the albedo (the alpha channel carries the team mask
  and must not be smeared by ETC1S's chroma subsampling), ETC1S for anything without
  alpha. `KTX2Loader` in three.js transcodes to the GPU's format.
- **Frame rate: 24 fps**, resampled on admission.

## 7. Tools required

| Tool | For | Install |
|---|---|---|
| Blender 4.2+ (5.2.1 here) | generation, previews, import | `brew install --cask blender` |
| `@gltf-transform/cli` | gate: validation, meshopt, KTX2 | `pnpm add -Dw @gltf-transform/cli` |
| KTX-Software (`ktx`, `toktx`) | KTX2 encoding | not in Homebrew: the macOS `.pkg` from github.com/KhronosGroup/KTX-Software/releases |
| ffmpeg | audio | `brew install ffmpeg` |
| ImageMagick | contact sheets, silhouette tests, image diffs | `brew install imagemagick` |

`docs/dev-setup.md` §Art has the details and the Blender MCP setup.
