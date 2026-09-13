# ADR-0022 — Spawns spread across the whole spawn zone and keep the fractional setback

- **Date:** 2026-09-13
- **Status:** Accepted — not implemented

## Context

Sending is unpaced (ADR-0006), so many creeps can enter on one tick, and creeps that share
a point are welded for the rest of the match (ADR-0021). Today's rule (`spawnPointFor`)
alternates between the two spawn tiles and steps each creep back along the route by a
fraction of a tile, giving 22 distinct points. The comment on it records a dead end that
must not be repeated: spreading creeps **across** the entrance fails, because `moveCreeps`
steers centre-to-centre, a sideways offset is gone at the first tile boundary, and two
creeps on one tile heading the same way weld.

The new spawn zone is 10 rows deep and 16 wide (ADR-0019), and the brief asks for mass
sends to arrive as a front rather than a column.

## Decision

Each spawned or respawned creep gets a position from the lane's `released` counter:

- a **column** across the zone and a **row** within it, chosen by coprime strides so
  consecutive releases land far apart;
- plus the existing **fractional setback** along the flow-field direction at that cell.

Distinct points: 16 columns × 10 rows × 11 setback slots = **1760**, against 22 today.
Respawn after a leak, and the teleport of a stranded creep, use the same rule.

- **Spread across the zone, keep the setback — CHOSEN.** A front, and the anti-weld
  mechanism survives intact.
- **Column spread only, on the far row — rejected.** The front is a line and the 10-row
  zone is decoration.
- **Today's rule at the zone centre — rejected.** Known to work, but a mass send is a
  column and the 16-wide lane gains nothing from the zone.

The brief's "seeded from the command tick and index" is satisfied by `released`: it is a
deterministic function of command order, it already covers respawns, and it needs no
second seed.

## Consequences

- **The fractional setback is load-bearing.** Path lengths from two columns to the first
  gap differ by their distance from it, so two creeps symmetric about a gap arrive together;
  only the setback keeps them distinct. A future edit that drops it "because the zone spreads
  them anyway" reintroduces welding.
- Spawn column is a small lottery: up to 15 tiles of extra walk between the luckiest and
  unluckiest creep of a send. Bounded, even across a send, and visible. Revisit trigger: it
  is felt as unfair in play, in which case fall back to the far-row spread.
- `MAX_SEND_BURST` in `bot.ts`, held at 22 to match today's budget, is re-derived from the
  new period.
- The distance-to-exit at spawn varies per creep, so the "maze length" figure reported to
  the player is the worst case over the zone, as `mazeLength` already computes over the
  spawn tiles.
