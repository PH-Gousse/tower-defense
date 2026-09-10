# ADR-0006 — No send queue, no in-flight cap

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

The original implementation had a release queue between a purchase and a spawn: a bought
creep entered a queue and was released into the lane at one creep every four ticks. The
stated reason was pacing; the real work it was doing was **separation**, keeping
simultaneously-bought creeps from landing on one point.

That queue capped a lane at five arrivals a second however fast the player clicked, which
made mass-sending impossible and quietly removed the Splash tower's reason to exist.

## Decision

**Buying a creep spawns it immediately** at the entrance of the opponent's lane, in the same
tick the command applies. No queue, no pacing, no in-flight cap. **Gold is the only thing
rationing a send.**

Separation is provided directly by `spawnPointFor`: creeps arriving together start at
different points **backwards along the route**, so they stay apart without anyone waiting.

The offset must go backwards along the route, not across the entrance. Creeps steer
centre-to-centre, so any sideways offset is gone the first time a creep crosses a tile
boundary, and two creeps sharing a tile heading the same way are welded together for the
rest of the match. Stepping *back along the flow field* turns a distance gap into a time
gap, and centre-snapping preserves time gaps.

## Consequences

- A mass send is a real tactic, and Splash is its answer. Five clicks make five creeps that
  arrive together and can be caught by one blast — that is the intended counter, not a
  defect. This deliberately does **not** try to spread a wave beyond splash range.
- There is a hard budget: `SPAWN_PERIOD = 22` distinct spawn points before the pattern
  repeats. The 23rd creep on a single tick starts where the first did and is welded to it
  forever. `MAX_SEND_BURST` in `bot.ts` is held at 22 to match. A human cannot outrun it —
  a tick is 50 ms, so two ×10 presses together stay inside the budget.
- `SPAWN_PERIOD` is what to raise if a bigger single-tick burst becomes possible, and it is
  nearly free: the slots subdivide a tile 1.0 across and nothing depends on the gap size.
- `Refusal.LaneFull` remains as a `MAX_CREEPS` backstop. It is not a design cap — it is
  sized past what gold can buy — but it refuses **before** the debit, because the
  alternative the code used to do was take the gold, grant the income, and drop the creep
  in silence.
