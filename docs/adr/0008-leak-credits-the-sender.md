# ADR-0008 — A leak credits the sender a life

- **Date:** 2026-09-10
- **Status:** Accepted — **not yet implemented**

## Context

When a creep reaches the exit, the defender loses a life. Whether the *sender* gains one is
a genuine fork, and the two options produce different games.

The implementation currently in `step.ts` credits nobody, with an explicit rationale:

> The sender gains nothing. Lives only ever go down, for everyone. Crediting the sender would
> make each leak a 2-point swing, so a leader would compound in lives and income at once with
> nothing pushing back.

That is a real concern about runaway leaders, and it was the working assumption through step
8.

## Decision

**The sender gains one life on a leak.** Confirmed 2026-09-10, overriding the code's
current behaviour.

A leak is therefore a two-point swing: the defender loses one, the sender gains one.

## Consequences

- Lives become a **shared pool that moves between players** rather than two independent
  counters that only fall. This is a substantially different match shape and every
  balance number tuned against the old behaviour is suspect.
- The runaway-leader concern in the old code comment is not answered by this decision, only
  overruled. It should be measured rather than argued: `balance-batch` should report the
  distribution of lead sizes over time before and after.
- Two things must be decided as part of implementing it:
  1. **Is there a cap on lives?** May a player exceed the starting figure of 20, and if so,
     is it unbounded?
  2. **Does the sender's gain interact with the win condition?** A player at 1 life who
     leaks successfully returns to 2; the "first to zero loses" check runs per tick, so
     ordering within the tick matters.
- `hashState` already covers `lives`, so no hash schema change is needed — but every golden
  fixture and every stored replay hash will move, and must be regenerated with a stated
  reason, through `/rule-change`.
- Until it lands, `docs/gdd.md` §8 carries this as a ⚠️ CONFLICT and the code is the bug.

Tracked as [issue #7](https://github.com/PH-Gousse/tower-defense/issues/7).
