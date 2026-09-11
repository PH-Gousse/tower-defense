# The flow, and the loop

```
description
   │  (≤3 questions if underdetermined)
   ▼
art/specs/<id>.yaml ──▶ spec-validate ──▶ asset-build ──▶ asset-preview ──▶ asset-critique
                          ▲                                                       │
                          │ asset-builder applies the                             │ art-director
                          │ parameter changes                                     ▼
                          └──────────────────────────── FAIL ◀── judgement ──▶ PASS
                                                                                  │
   asset-gate ◀───────────────────────────────────────────────────────────────────┘
      │ ADMIT                                  │ REJECT: every violation listed
      ▼                                        └──▶ fix the spec (never the budget) ──▶ rebuild
   manifest + LICENSES + manifest-types
      │
      ▼
   bindings.ts row ──▶ audio placeholders ──▶ game-proposal ──▶ SHOW previews ──▶ STOP
```

## What "the critique passes" means

Every row of the judgement table in `critique.md` is Pass, and the measured table has no
`FAIL`. `borderline` and `check shading` are allowed with a note. The art-director writes the
verdict line; the builder never edits the judgement half.

## Iteration budget

Four rounds. Each round changes **parameters** (size, parts, palette roles, animation
parameters), never the budget, the contract or the style sheet. If a fourth round still
fails, stop and report the failing rows: the request may need a new body plan or a style
decision, and both are the owner's call.

## What the owner sees at the end

The lineup render (the asset beside its tier siblings and archetype peers), the critique,
the gate line, and the game-data hand-off. Never a claim of "done" without the images.
