# ADR-0007 — Creeps loop until towers kill them

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

In a conventional tower defence, a creep that reaches the exit is removed and the defender
takes a penalty. The leak is a discrete event with a fixed price.

That makes leaking *cheap under pressure*: once a wave is clearly getting through, the
defender's best move is often to stop spending on it. It also makes the attacker's
investment evaporate at the moment it succeeds.

## Decision

A creep that reaches the exit is **not removed**. It is placed back at the entrance of the
**same** lane with its **current HP**, its lap counter increments, and it runs again.

**No lap cap, no HP decay, no timeout.** Tower damage is the only thing that removes a
creep from the board.

A leak costs the defender one life and — per the confirmed rules — gains the sender one.

## Consequences

- Leaks are a **drain, not a penalty**. One creep your maze cannot kill is enough to lose
  the match eventually, which is the pressure the whole design rests on.
- The defender can never write off a wave. A creep left alive keeps costing lives every lap
  forever, so there is no point at which ignoring it is correct.
- The attacker's gold stays on the board doing work until it is answered.
- Creep population is bounded only by how fast towers kill relative to how fast creeps
  arrive. If the damage ramp is mistuned, the count climbs without limit — which is why
  `Refusal.LaneFull` exists as a backstop and why peak creep population is a tracked render
  budget (~500).
- A creep walled in mid-field with no route **teleports to the entrance** rather than the
  placement being refused. Walling a creep in then costs the trapper towers and achieves
  nothing.
- **Unresolved:** bounding the creep ladder at three tiers removed the arithmetic guarantee
  that a match ends. Nothing replaces it. See the GDD §5 and the tracking issue.
