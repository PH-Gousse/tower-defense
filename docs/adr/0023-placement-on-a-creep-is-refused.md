# ADR-0023 — A placement whose footprint holds a creep is refused

- **Date:** 2026-09-13
- **Status:** Accepted — implemented 2026-09-13 in the sim and the client (amber wait ghost). Supersedes
  the "teleport instead of refuse" half of ADR-0012.

## Context

ADR-0012 decided two things: the block check consults the spawn tiles and not creep
positions, and a creep left standing under a new tower or with no route **teleports back to
the spawn**. Its reasons were that legality would flicker as creeps walk, and that refusing
on creep positions would let a cheap swarm send lock tiles out of the defender's maze.

The first decision stands. The second does not survive ADR-0019's lane. On 24 rows the
teleport cost the attacker about fifteen seconds. On 213 rows it is 70 to 200 seconds of
walking, and the defender buys it by placing a 600-gold tower on the creep and selling it
back for 60%: **240 gold to send a tank from the exit to the spawn**, cheaper than the
tank. That is a trade the defender would take on every dangerous creep, every lap.

## Decision

**A placement whose 2×2 footprint contains any creep's current tile is refused, with the
refusal `CreepOnFootprint`**, checked after `OverlapsTower` and before `WouldBlock`, and
like every refusal before any gold moves.

- **Refuse — CHOSEN.** No reset exploit, and it is what the original does.
- **Allow and displace the creep to the nearest walkable cell, farthest from the exit
  first — rejected.** No flicker and no denial, but displacement across a wall lands the
  creep in a different corridor, a shortcut or a whole serpentine leg of setback depending
  on the maze, and it reads as a glitch. Kept as the fallback if refusal proves
  exploitable the other way.
- **Allow and teleport to spawn (ADR-0012 as shipped) — rejected** on the arithmetic above.

The block check itself is unchanged from ADR-0012: it asks whether the spawn zone still
reaches the exit zone and never consults creep positions.

## Consequences

- **Legality flickers** on a footprint as creeps cross it. The build ghost therefore shows
  a third state, blocked-by-creep, distinct from illegal, so a click that lands a tick late
  is understandable rather than mysterious. The refusal message names the reason.
- **Denial is possible but priced.** A stream of creeps across the 16-wide front blocks a
  cell for one tile-time per creep, 0.2–1 s at converted speeds, so denying a defender a
  row needs sustained flow paid in gold, which the original also tolerates. Revisit trigger:
  playtests where the front actually locks defenders out of their own maze.
- A creep stranded by a legal placement elsewhere (a pocket sealed while it stood inside)
  still teleports to the spawn zone. It is rare, because creeps follow the flow field and are
  not in pockets unless the field changed under them, and it costs the trapper the towers.
- `Refusal` gains a member, so `packages/server/src/protocol.ts` gains one too (issue #9).
- The GDD's §3 conflict ("placement on an occupied tile is refused" versus the shipped
  code) resolves toward the stated rule.
