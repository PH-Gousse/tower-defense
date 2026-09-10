# ADR-0011 — `dump.ts` is a declared serialisation boundary

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

`packages/sim` bans `Date` and key-order-dependent `JSON` use, because the sim must be a pure
function of `(state, commands)` and reproducible across engines.

`packages/sim/src/dump.ts` violates both. It calls `new Date().toISOString()` to stamp a
desync dump with wall-clock time, and `JSON.parse` to read one back.

It is the only file in the package that does, and it is exported from `src/index.ts`, so it
is part of the sim's public surface.

Two options: move it out of the package, or declare it an exemption.

## Decision

**Declare it a boundary.** `dump.ts` may use `new Date()` and `JSON.parse`. It is the only
exemption in `packages/sim`, and a second one is a `/rule-change`.

The justification is that it is never on the `step()` path. It serialises and deserialises
*around* the simulation; nothing inside a replay reads the timestamp, and `parseDump` is
schema validation, not logic that depends on key order.

Moving it out was rejected because a dump must carry `BalanceData`, `Command`, `HashEntry`
and the data-version constants — all sim-owned types — so a separate package would either
duplicate them or invert the dependency, and the file would still be doing exactly the same
thing under a different path.

## Consequences

- `banned-api-scan` and `determinism-check` must carry an explicit allowlist entry for this
  one file, visible in their output rather than silent. A scanner with an invisible
  exception is worse than no scanner.
- The exemption is file-scoped, not package-scoped. New code in `dump.ts` still gets read
  with suspicion; the pre-edit hook still reports what it found there.
- `eslint.config.js` does not currently flag either call (`Date.now` is banned, `new Date()`
  is not; `JSON` is not restricted at all). The scanner is therefore stricter than the
  linter, deliberately.
