---
name: asset
description: The asset factory's one entry point. `/asset new|evolve|import|source|review|regen|retire|audio|status` takes an art request from a one-line description to a built, gated, previewed, critiqued, registered asset wired into the client and proposed into the game data, and maintains the catalogue over time. Never presents an asset as done without its previews.
disable-model-invocation: true
argument-hint: "<new|evolve|import|source|review|regen|retire|audio|status> [args]"
allowed-tools: Read Write Edit Grep Glob Bash(pnpm spec-validate*) Bash(pnpm asset-*) Bash(pnpm audio-*) Bash(pnpm manifest-types*) Bash(pnpm game-proposal*) Bash(git diff *) Bash(git log *) Bash(git status*) Bash(gh issue *) Bash(magick *) Bash(ls *) WebSearch WebFetch
---

# /asset

Subcommand, then arguments. Every subcommand ends by **showing previews and stopping for
approval**; nothing here commits, applies game data, or marks a critique passed on its own.
The flow and the loop are in [`flow.md`](flow.md); the rules each subcommand obeys are in
[`rules.md`](rules.md). Read both before the first run in a session.

| Subcommand | Does |
|---|---|
| `new <class> <archetype> "<description>"` | the canonical flow: spec → validate → build → preview → critique → iterate → gate → manifest → binding → audio → game-data proposal → show → stop |
| `evolve <id> "<what changes>"` | a derived spec for the next tier or level using the style sheet's tier language, same flow |
| `import <file> --as <id>` | an external model through the `imported` body plan; **refuses without source and licence** |
| `source "<need>"` | search allowed sources (CC0 first), propose candidates with licence and previews, ask before paid or AI, then `import` |
| `review <id>` | regenerate previews and the critique for an existing asset |
| `regen [--changed \| --all]` | rebuild after a generator or style change; report what changed visually |
| `retire <id>` | remove from the manifest and the build; refuses on a dangling reference |
| `audio <event> "<description>"` | synthesise or import a sound for an event, normalise, register, bind |
| `status` | the catalogue: what exists, what is stale, what lacks a clip, a sound or a licence, what awaits approval |

## Dispatch

Parse `$ARGUMENTS`: the first word is the subcommand. Unknown subcommand: print the table
above and stop.

### new

1. **Settle the spec.** From the description, pick the body plan, rig, parts, palette roles
   and clips using `art/generators/generators.md` and `docs/art/style-sheet.md`. Ask at most
   **three** questions, only where the description underdetermines something the style sheet
   does not settle (body plan, tier language, an archetype the sheet lacks). Otherwise proceed.
2. Write `art/specs/<id>.yaml` (the **asset-builder** subagent is the only writer of specs;
   delegate to it or follow its rules yourself). Include `game:` from the description if it
   names numbers; otherwise copy the live archetype's numbers, marked in a comment.
3. `pnpm spec-validate <id>` → fix until clean.
4. `pnpm asset-build <id>` → `pnpm asset-preview <id>` → `pnpm asset-critique <id>`.
5. **Critique loop.** Hand `reports/art/<id>/critique.md` and the images to the
   **art-director** subagent. It fills the judgement and lists parameter changes. Apply them
   to the spec (asset-builder), rebuild, re-preview, re-critique. **At most 4 rounds.** A
   critique that still fails after 4 stops with the failures listed; do not lower the bar.
6. `pnpm asset-gate <id>`. A rejection lists every violation; fix the spec, not the budget.
7. `pnpm manifest-types`. Add or confirm the binding in
   `packages/client/src/assets/bindings.ts` (a new archetype's size class in `SIZE_OF`, a new
   tower's `TOWER_FX`). Nothing else in the client changes for a new asset.
8. Audio: for every sound event the binding names that the manifest lacks, run the `audio`
   subcommand with a placeholder description.
9. `pnpm game-proposal <id>` → read `reports/art/<id>/game-proposal/handoff.md`.
10. **Show and stop:** the lineup render, the critique's verdict and measured table, the gate
    line, the game-proposal status, and the exact `/rule-change` sentence to run next.

### evolve

Read the parent spec. Write the child with `derived_from`, applying the tier language
(`docs/art/style-sheet.md` §5): size ×1.10 / ×1.20, one part on a primary point at tier 2
and a second at tier 3, `tier_shift` 0.25 / 0.5, `trim: true` and an `emissive_trim` part at
tier 3. Keep the parent's rig and clips unless the description says otherwise. Then steps 3–10
of `new`. The lineup must show the parent beside the child.

### import

Refuse to continue until the invocation or the conversation gives **kind, licence, author or
URL**, and for cc-by an attribution line; for `ai`, `freelance` or `other`, the approver's
name. Copy the file under `art/source/`, write the spec with `body_plan: imported`,
`import.file`, `forward`/`up` as the file has them, a `slot_map` if its materials are named,
and `clip_map` if it carries clips. Then steps 3–10 of `new`. Retargeting onto a rig template
is not implemented; say so if asked, and use the file's clips or the root-only procedural set.

### source

Search in this order and stop at the first with a fit: Kenney (CC0), Quaternius (CC0), Poly
Pizza filtered to CC0, OpenGameArt filtered to CC0, then CC-BY sources, then — **only after
asking** — paid or AI generators. Present at most three candidates: name, licence, URL, a
preview image if the page has one, triangle count if stated. Never download without the
licence recorded. On a pick, run `import`.

### review

`pnpm asset-preview <id>` → `pnpm asset-critique <id>` → art-director fills the judgement →
show and stop.

### regen

`pnpm asset-regen --changed` (or `--all`). Show the list of assets that changed visually with
their before/after strips from `reports/art/<id>/regen/`, and stop for review. Do not gate
past a rejection.

### retire

`pnpm asset-retire <id>`. If it refuses, show the references and stop; never `--force`
without being told to. On success, run `pnpm asset-report` and show the sibling note if any.

### audio

For a synthesised placeholder: write `art/sounds/<sfx_id>.yaml` (event, variant, layers from
the description: a "click" is a filtered noise burst, a "thud" a sine drop, a "chime" a
detuned pair of sines; see the two existing specs) and run `pnpm audio-synth <sfx_id>`. For a
file: `pnpm audio-import <file> --as <sfx_id> --event <event> --kind … --licence …`, refusing
without those. Then confirm the binding (`bindings.ts`) names the event, run
`pnpm manifest-types`, and report the measured loudness.

### status

`pnpm asset-report` and read its JSON line. Report, in this order: assets admitted / stale /
invalid; missing required clips; assets awaiting approval (critique `PENDING`); sources
needing sign-off; sounds admitted and the events in `docs/art/audio.md` still without one;
orphans. Link `reports/art/index.html`.

## Finish by printing

```
ASSET:     <id>  <class> <archetype> <tier/level>
GATE:      admitted <tris> tris · <bones> bones · <clips> clips · <KB> KB  |  REJECTED: <codes>
CRITIQUE:  <PASS|FAIL|PENDING> — <one line>   reports/art/<id>/critique.md
PREVIEWS:  reports/art/<id>/lineup.png  turntable.png  clip_*.png
BINDING:   <table rows touched, or "none needed">
AUDIO:     <sfx ids synthesised/imported, or "all events already had sounds">
GAME DATA: <matches|changes|new|growth-mismatch> — reports/art/<id>/game-proposal/handoff.md
NEXT:      /rule-change "<sentence>"   |   nothing to apply
AWAITING:  your approval of the previews above
```
