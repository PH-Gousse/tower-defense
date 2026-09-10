# ADR-0010 — Seeds are reserved, not consumed

- **Date:** 2026-09-10
- **Status:** Accepted — provisional, revisit when the harness needs variance

## Context

The tooling specification asks for `headless-match --seed`, `determinism-check` over "N
seeds", and `balance-batch` over "M matches across seeds".

Nothing in the simulation currently consumes a seed. There is no randomness anywhere in the
v1 rules: no crits, no spawn jitter, no random targeting. The bot breaks ties by index.
`mulberry32` exists in `rng.ts`, is exported, and is explicitly unused — its own comment says
"if the bot ends up not needing it, delete this file and the seed with it".

The consequence is that every `normal vs normal` match is byte-identical. Running it under
20 different seed values produces 20 identical matches, which would make
`determinism-check` a test that runs the same thing 40 times and `balance-batch` a report
with a sample size of one dressed up as a sample size of M.

## Decision

Do not fake it. `--seed` selects a **configuration** from the real variation the game has —
the cross product of three `MAZE_TEMPLATES` and three bot presets — and every script says so
in its output and its `--help`.

The `seed` field stays in the replay format, reserved. `mulberry32` stays.

Scripts report the configuration they resolved a seed to, so a reader is never misled about
how much independent variation a run actually covered.

## Consequences

- `determinism-check` is honest: it verifies that a *given* configuration reproduces
  identically twice, across the 9 configurations that exist. That is the property that
  matters and it is fully tested.
- `balance-batch` has a real ceiling of 9 distinct matchups (plus mirrors), not M. Reports
  state the true distinct-configuration count alongside M.
- To get genuine variance, something must consume a seed. The cheapest honest option is
  seeded tie-breaking in `botCommand` — but that is a rule change to the AI and belongs in
  `/rule-change`, measured, not slipped in to make a script's flag meaningful.
- Revisit this ADR the first time a balance question needs more than 9 samples to answer.

Tracked as [issue #10](https://github.com/PH-Gousse/tower-defense/issues/10).
