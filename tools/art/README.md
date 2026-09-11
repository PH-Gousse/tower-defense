# tools/art

The pipeline scripts, one pnpm alias each: `spec-validate`, `asset-build`, `asset-gate`,
`asset-preview`, `asset-critique`, `asset-report`, `audio-import`, `audio-synth`,
`manifest-types`. TypeScript, run with vite-node like `packages/harness/tools/`; each
prints a human summary and one JSON line last, exits non-zero on failure, and checks its
own dependencies with an install hint.

`docs/art/pipeline.md` is the reader's guide.
