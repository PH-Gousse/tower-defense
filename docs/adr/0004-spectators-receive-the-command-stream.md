# ADR-0004 — Spectators receive the same command stream

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

Spectating is normally its own feature: a separate serialisation, a separate rate, a
separate set of bugs, and usually a downgraded view because sending full state to observers
is expensive.

## Decision

A spectator is a client that receives the same command stream the players receive, and
simulates it locally with the same `packages/sim`. It simply has no command source of its
own.

No spectator-specific protocol, no state snapshots, no separate serialisation path.

## Consequences

- Spectators see exactly what players see, at full fidelity, because they are running the
  same simulation — not an approximation of it.
- Spectator cost to the relay is one more fan-out target. It does not grow with world size.
- A spectator joining mid-match needs the log **from tick 0** and must fast-forward, since
  there are no snapshots to join against. For a ~20-minute match at this command rate that
  is cheap; if it ever stops being cheap, the answer is periodic snapshots as an
  *optimisation*, not as a second source of truth.
- The same mechanism gives replay-from-URL: a spectator of a match that already finished.
