# ADR-0028 — A tower takes time to acquire before its first shot

- **Date:** 2026-09-15
- **Status:** Accepted — implemented 2026-09-15; the sizing is `[proposed]` and `[retune]`

## Context

A tower fired on the very tick a creep entered its range. With instant damage and no
projectile (GDD §4) that made an idle tower a perfect sentry: the first step into range
was always a creep's worst, and there was no visible moment between "seen" and "hit" for
the renderer to show or the player to read. The user asked for a lapse between detection
and the attack.

## Decision

**Each tower carries an `acquire` counter.** With nothing in range it is reset to
`acquireTicks`; while the tower has a target it counts down one per tick, and the tower
fires only when it reaches zero. So the first shot lands `acquireTicks` ticks after a creep
first appears, and a tower that keeps finding targets stays locked on and fires on every
cooldown with no second wait. It waits again only after a tick with nothing to shoot. A
newly built tower starts at the full delay even if a creep is standing in range.

The counter is untouched during cooldown: a tower is either winding up or cooling down,
never both, so the state stays one integer each and the hash covers both. `acquireTicks`
lives in `towers.json` (version 6), is pinned in `BalanceData`, and is optional there so a
fixture recorded before it existed replays as fire-on-sight.

Sized **10 ticks, half a second** at 20 Hz. A runner covers about three tiles in that
time and a tank about one and a half, against ranges of 4.5 to 10.5 tiles. `[proposed]`,
`[retune]` like everything in §11.

Rejected:

- **A delay per archetype or per level.** Nothing measured says they should differ, and
  one number is one thing to tune. A per-level field can be added if `/balance` wants it.
- **Counting down through cooldown too.** Then a tower that lost its target mid-cooldown
  would fire at the next one on sight, and the rule would read differently for busy and
  idle towers.
- **Charging shown as a projectile.** Damage stays instant (GDD §4); the delay is before
  the shot, not travel after it.

## Consequences

- Tower damage per engagement drops by up to one shot for idle towers; streaming sends
  barely notice. The bot's flood model (`threat.ts`) does not subtract the delay, which
  errs toward the defender by a fraction of a shot per tower per idle gap.
- Both golden fixtures now pin `acquireTicks: 10` in their data blocks and were re-hashed
  for it; the replays were regenerated. `hashState` covers the new counter, so every hash
  moved even for a fixture without the key; that the behaviour did not was checked by
  replaying both fixtures with the key absent on the old and the new sim and comparing
  the final states field by field (gold, income, lives, leaks, kills, creep positions and
  HP, tower cooldowns): identical.
- The client can read `acquire` to show a tower winding up; it does not yet.
