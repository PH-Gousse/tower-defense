# ADR-0025 — Balance constants get a geometric conversion and are void until `/balance` runs on the new lane

- **Date:** 2026-09-13
- **Status:** Accepted — geometric conversion applied 2026-09-13 (creeps.json v7, towers.json v4); the `[retune]` pass is pending `/balance`

## Context

A bare lap goes from 29 tiles to 213 (ADR-0019), a factor of 7.3. At today's speeds:

| Creep | Old bare lap | New bare lap |
|---|---|---|
| Swarm (1.5 tiles/s) | 19 s | 142 s |
| Runner (3 tiles/s) | 10 s | 71 s |
| Tank (1 tile/s) | 29 s | 213 s |

Income pays every 15 s, so 9 to 14 payouts per bare lap instead of 1 or 2, and the 5-minute
tier clock sits inside a couple of laps rather than tens of them. Tower ranges of 1.5–3.5
tiles were halved when the lane went from 40 wide to 8 wide (`towers.json`); against a
2×2 tower they are now shorter than the tower.

Converting the original's units: a terrain tile is 128 units and holds one tower, so a creep
tile is 64 units. Its creeps move at roughly 270–350 units/s, which is **4.2–5.5 creep
tiles/s, about three times ours**. Its tower ranges of roughly 600–900 units are **9–14
creep tiles, three to four times ours**.

## Decision

- **First, a geometric conversion, not a tuning:** creep speed ×3 and tower range (and
  splash radius) ×3, through `/rule-change`. Income interval and tier clock untouched. Every
  ratio the roster was tuned on (HP per gold, gold per damage, bounty tax) survives, so
  `/balance` starts from a known shape and there is one factor to argue about.
- **Every constant in GDD §11 is marked `[retune]` and is void** until `/balance` has run on
  the new geometry. No balance finding recorded before this date applies to the new board.
- **Precondition for `/balance`:** the bot's maze templates are regenerated for 16-wide,
  2×2, half-slot mazing. Until then a batch measures a bot with no maze.

Rejected:

- **Retune speed, income tick and tier clock by hand now.** Three knobs moved blind before
  one match has run; cannot be bisected.
- **Hold the constants and run `/balance` blind.** The bot's mazes are void, and a 142 s
  swarm lap puts every match past the batch's 40 000-tick ceiling.

## Consequences

- A full 200-row half-slot maze may still take 5–10 minutes a lap after the conversion, so
  the tier clock and the income interval are the likely first `/balance` proposals. That is
  the intended order: measure, then move.
- `LANE_LENGTH` is the one lever nothing else pins. If converted lap times are unacceptable,
  shortening it is a smaller change than re-deriving the roster.
- The golden fixtures are regenerated once, after the geometry and the conversion have both
  landed, not once per step.
- Issues #12, #13, #14 and #26 were measured on the old board and are re-checked rather
  than trusted.
