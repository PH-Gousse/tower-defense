# ADR-0033 — Sudden death is removed

- **Date:** 2026-09-17
- **Status:** Accepted
- **Supersedes:** [ADR-0026](0026-sudden-death-on-the-clock-ends-every-match.md)

## Context

ADR-0026 added sudden death: from 15:00, every creep sent spawned with its HP multiplied by
×1.15 per income period, compounding. It existed because two strong mazes could kill
everything the creep ladder offered, so a match could run forever with nobody losing a
life.

The user did not want it: *"The game should NOT finish after 15:00! It should finish when
the life of a player reach zero."* Sudden death never ended a match by itself, but it was
a clock deciding matches, and the user's rule has no clock. Lives decide, and a leak steals
one ([ADR-0032](0032-a-leak-steals-a-life-losses-settle-before-gains.md)).

## Decision

**No sudden death.** `creeps.json` no longer carries `suddenDeathTick` or
`suddenDeathGrowth`, and the loader reads their absence as "never". The HUD row that counted
down to it is gone.

The mechanism stays in the sim, off in the shipped data. A replay pins its own balance
data, and the recorded replays and golden fixtures were recorded with sudden death on, so
removing the code would change the matches they recorded. `suddenDeath.test.ts` still pins
the mechanism, installed at its old sizing.

**Rejected:**
- *Tune it later or slower.* It would still be a clock deciding matches, which is what the
  user objected to.
- *Delete the code.* Every stored replay recorded under it would stop reproducing its hash,
  for no gain to the game.

## Consequences

- **Nothing but the ladder and the players' sends forces a match to end.** The balance
  problem ADR-0026 answered is back: two mazes that out-scale the ladder can hold
  indefinitely. With steals, lives also move both ways. Whether real play reaches that stall
  is unmeasured.
- The roster-derived HP cap from ADR-0031 has nothing to cap in shipped play. It still
  guards replays recorded with sudden death on.
- The bot's flood model already takes the sudden-death factor as a parameter. It now
  always reads 1.
