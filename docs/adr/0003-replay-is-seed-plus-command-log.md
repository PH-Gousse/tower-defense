# ADR-0003 — A replay is a seed plus a command log

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

Given ADR-0001 (deterministic sim) and ADR-0002 (commands over the wire), a full recording
of a match is already being produced by the relay. The question is only what a replay file
needs to *contain* to be re-runnable later.

## Decision

A replay is `{ seed, commandLog }` — plus the **frozen balance data** it ran under.

The balance data is not optional and was the expensive lesson. Tuning is hundreds of edits
to `creeps.json` and `towers.json`, and every one changes the final hash of every recorded
match. A replay that reads *live* data gets regenerated rather than investigated, which
turns the keystone regression test into a rubber stamp. The golden fixture claimed to pin
its own data for six development steps before it actually did; step 8 changed a creep's HP,
watched the hash move, and found it reading live data the whole time.

So: `installBalanceData(replay.balance)` before re-simulating, restore afterwards.

Verification is by final state hash, compared bit for bit.

## Consequences

- Replay files are tiny — a command log, not a state stream.
- A desync at a player's machine becomes a local, repeatable run. It answers the question
  that matters, which is not "did it break" but **which side was wrong**: replay the log
  locally and compare against both peers' recorded hashes.
- A red replay after a balance change is *expected*, not a regression — but the two must be
  told apart deliberately. `/rule-change` regenerates fixtures and says why; `/replay-verify`
  interprets which happened.
- Nothing currently consumes the seed: the sim has no randomness and the bot breaks ties by
  index. `mulberry32` exists unused. The `seed` field is reserved, and until something reads
  it, "run N seeds" means "run N configurations". See ADR-0010.
- Replay format versioning is not built. A months-old replay from before a schema change
  cannot be re-run. Tracked as debt.
