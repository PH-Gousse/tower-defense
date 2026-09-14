# ADR-0026 — Sudden death on the clock guarantees every match ends

- **Date:** 2026-09-14
- **Status:** Accepted — implemented 2026-09-14; the sizing is `[proposed]` and `[retune]`

## Context

The twenty-tier ladder ended every match by arithmetic: geometric HP growth passed any maze
eventually. Bounding the ladder at three tiers (creeps.json v6) removed that without
replacing it, and issue #8 recorded the gap. On the 16-wide lane the heaviest creep is Tank
III at 6 250 HP while `lap` says a 30-tower level-3 maze needs 81 000 HP to survive a lap and
a 120-tower one 415 000. Matches still end today only because income compounds to millions
and Swarm III floods overwhelm both sides at once: bot mirrors end as same-tick double
knockouts at 20 to 22 minutes, and at 31 to 35 minutes under the model counter-pick, which
is why that pick could not ship (#12). Two humans who both build past saturation can sit
forever.

## Decision

**From a fixed tick after the last tier unlock, the HP of every creep spawned multiplies by
a factor per income period, compounding.** `suddenDeathTick` and `suddenDeathGrowth` live
in `creeps.json`; both optional, so a replay or golden fixture recorded without them
reproduces the match it recorded. Sized `[proposed]`: 18 000 ticks (15:00) and ×1.15 per
300-tick period, which carries Tank III past 81 000 HP 4.6 minutes in and 415 000 HP 7.5
minutes in, so no maze survives past about 23 minutes. The factor is a table built at load
by repeated multiplication (no `pow`), capped so an `Int32` HP cannot overflow. The bot's
flood model reads the scaled HP. The HUD shows the sudden-death clock beside the tier
clock.

Rejected:

- **More tiers at the same ×5 step.** A fourth tier's Tank IV is 31 250 HP, short of
  81 000; reaching 415 000 needs eight tiers, a 35-minute unlock clock and 24 palette
  buttons — the old ladder back.
- **A tower cap per lane below saturation.** ADR-0019 sized the lane for 320 towers on 200
  rows; a cap of 40 makes the length pointless and removes the end-game a full maze is.
- **Creep HP scaling with the defender's tower count.** Punishes mazing, the skill, and
  makes a creep's strength depend on the opponent's board, which the palette and the
  flood model would both have to explain.
- **Reforged's rule, creeps take more damage over time.** Points the wrong way: it
  strengthens mazes and widens the gap.

## Consequences

- A duel has a hard horizon: whatever the boards, it ends within a few minutes of sudden
  death starting. The tier clock and this clock are the two beats a player plans around.
- The start tick and the growth are the first things `/balance` should move if matches end
  too early or too late; both are `[retune]` with the rest of §11.
- Issue #8 closes. The harness's 25-minute mirror pin becomes a consequence of a rule
  rather than a hope, and the model counter-pick (#12) can be re-measured under it.
