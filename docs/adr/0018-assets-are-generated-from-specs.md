# ADR-0018 — Assets are generated from specs, and the built files are committed

- **Date:** 2026-09-11
- **Status:** Accepted

## Context

ADR-0015 chose a procedural look and ADR-0017 synthesised sound, and both recorded the same
consequence: *no binaries, no pipeline, the repository stays text.* That held while every
model was a few merged primitives and every sound an envelope on an oscillator. It stops
holding the moment the game needs rigged, animated, textured creatures with a tier
language, a team colour and a licence trail — which is what the asset factory
(`docs/art/pipeline.md`) exists to produce.

The forces: the look must stay reproducible and reviewable as a diff; a clone must run the
game without a modelling toolchain; the client is deployed as static files to GitHub Pages;
and the catalogue will be regenerated whenever the style sheet moves.

Three ways to carry the output were on the table:

- **A. Commit `assets/build/` as plain files.** Clone and deploy work unchanged. The whole
  v1 catalogue is under 15 MB by the budgets. Every regeneration writes new binaries into
  history.
- **B. Commit through Git LFS.** History stays small. Contributors and CI need `git lfs`, the
  Pages workflow needs an LFS checkout, and GitHub's free LFS quota is 1 GB of storage and
  1 GB a month of bandwidth — a busy month of regenerations could exhaust it.
- **C. Do not commit the build; regenerate in CI from specs.** The repository is provably the
  truth. CI needs Blender and KTX-Software on every run, and a checkout cannot run the game
  without the full toolchain.

## Decision

**Every asset is generated from a declarative spec (`art/specs/<id>.yaml`) by the generator
library (`art/generators/`) at a commit, and the gated output in `assets/build/` is
committed to git as plain files (A).**

`assets/build/` is a cache of the specs and generators, never a source: nothing lands there
except through `asset-gate`, nothing in it is edited by hand, and a hook rejects the attempt.
Externally sourced models enter through the same specs as an `imported` body plan and pass
the same gate. The sim is untouched; the renderer still infers every event from two ticks,
exactly as ADR-0015 describes.

B is rejected for now rather than forever: at this catalogue size plain files cost less than
the quota risk and the tooling burden, and switching later is a one-time `git lfs migrate`.
The trigger for revisiting is a regeneration cadence above a few per week, or the built
catalogue passing about 50 MB. C is rejected because a clone that cannot run the game is a
worse default than a large history.

This supersedes the "no binaries, no pipeline" consequence of ADR-0015 and the "no
binaries, no loader" consequence of ADR-0017, and nothing else in either. The procedural
models in `models.ts` and the synthesised sounds in `audio.ts` remain the fallback until the
catalogue replaces them, and the synthesiser remains the source of every placeholder sound.

## Consequences

- The repository carries binaries. `git log --stat` on an art commit is a list of `.glb`,
  `.ktx2`, `.webm` and `.mp3` files, and the diff that explains them is the spec.
- The reproducibility guarantee is the load-bearing property: same spec, same generator
  version, same bytes. A build that differs from the committed file is a bug in the
  generator, not a reason to commit the new file.
- The client gains a loader, a registry and an animation layer (Phase 6 of the factory).
  The wall between renderer and sim stays exactly where it is.
- `art/source/*.blend` and `assets/raw/` are decided separately: they are intermediate
  files, larger than the build, and the LFS question is asked for them on their own.
- Deploy is unchanged: Vite copies `assets/build/` into `dist/`, and Pages serves it.
