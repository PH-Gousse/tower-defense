# Rules every subcommand obeys

- **Budgets are enforced, not advisory.** A failing asset changes; the budget does not. Never
  edit `tools/art/lib/budgets.ts` or `docs/art/style-sheet.md` §7 from here (`/style-sheet`
  is the path, and it is a decision).
- **Nothing enters `assets/build/` except through `asset-gate`.** A hook rejects hand edits
  there and to `assets/manifest.json`, `assets/LICENSES.md` and every generated file.
- **No licence, no build.** `source.licence` is mandatory; `ai`, `freelance` and `other`
  need `approved_by` before the gate admits.
- **The sim, the constants and the GDD are never edited from the factory.** `game-proposal`
  writes to `reports/`; `/rule-change` applies.
- **Deterministic per spec.** If two builds of one spec differ, that is a bug to fix in
  `art/generators/`, not a reason to rebuild until it passes.
- **No Warcraft anything.** Not in specs, references, descriptions or sourced files.
- **Specs are written by the asset-builder role only.** The art-director reads images and
  writes critiques; the art-librarian reads the manifest and writes reports.
- **Every spec edit is followed by `spec-validate`.** A hook runs it; read its output.
- **Never present an asset as done without its previews.**
