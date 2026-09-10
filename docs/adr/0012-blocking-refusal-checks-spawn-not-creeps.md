# ADR-0012 — Sealing is checked against the spawn, not against creep positions

- **Date:** 2026-09-10
- **Status:** Accepted — `[proposed]` in the GDD, pending confirmation

## Context

A tower placement that would seal the lane must be refused. The question is what "seal"
means when there are creeps standing in the lane.

Two candidate rules:

1. Refuse if no route would remain **from the entrance tiles to the exit**.
2. Rule 1, **plus** refuse if the tile is currently occupied by a creep, or if any live
   creep would be left with no route.

Rule 2 is the stated rule in the project brief.

## Decision

**Rule 1.** `checkBuild` runs a candidate rebuild of the flow field with the tile blocked and
asks only whether the **spawn tiles** still reach the exit. Creep positions are not consulted.

A creep that ends up with no route from where it stands **teleports back to the entrance**
and runs again, keeping its HP and lap count.

## Consequences

Two reasons, both load-bearing:

- **Legality would flicker.** Creeps move every tick, so a tile's buildability would blink
  on and off as they walk past it. The build preview would be lying most of the time, and a
  click would land or not depending on a 50 ms window.
- **It would be exploitable.** If occupying a tile made it unbuildable, a cheap swarm send
  would lock tiles out of the defender's maze — attackers would gain map control by
  standing on it, which is a different and much worse game.

The teleport-instead-of-refuse rule has its own justification: walling a creep in costs the
trapper the towers and achieves nothing, which was always the requirement.

Costs accepted:

- A player can wall a creep in and watch it teleport, which reads as a small oddity until
  you know why.
- Selling never needs a reachability check at all, since removing an obstacle can only open
  paths. Build is the dangerous direction; sell is free.
