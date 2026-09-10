# ADR-0001 — A shared deterministic TypeScript simulation

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

A 1v1 real-time game needs the client, the server, the AI opponent, replays and headless
balance runs all to agree on what happened. The alternatives were to implement the rules
once per consumer, or to implement them once and share the artifact.

Sharing only works if the shared thing is *exactly* reproducible. Two machines running the
same match must reach the same state bit for bit, on different CPUs, different browsers and
different JavaScript engines — otherwise every downstream feature needs its own
reconciliation story.

IEEE 754 pins `+ - * / sqrt` to exact results on every conforming engine. It does not pin
the transcendentals: each platform ships its own libm and they differ in the last bits.

## Decision

One package, `packages/sim`, holding all the rules. Pure TypeScript, zero runtime
dependencies, no imports of any kind outside itself.

Determinism is bought by restriction, not by hope:

- fixed 20 Hz tick
- arithmetic restricted to `+ - * /`, `Math.sqrt`, and the exactly-specified integer
  operations (`floor`/`ceil`/`round`/`abs`/`min`/`max`/`trunc`/`sign`/`imul`)
- every iteration order fixed and documented as a pin (see `invariants.md` rule 4)
- no clock, no randomness, no I/O, no DOM

Enforcement is layered. `eslint.config.js` makes a violation unlikely; the cross-engine
golden fixture makes it *visible*. CI runs the same committed command log to the same
committed hash under V8 (node) and JavaScriptCore (bun). A lint rule cannot see everything —
the fixture can.

## Consequences

- Replays, spectating, the AI opponent and headless balance runs all fall out of this one
  decision rather than each needing to be built.
- Desync detection becomes a hash comparison instead of a state diff.
- The restriction is real and permanent. Anything needing a transcendental — curved
  projectiles, angular targeting, exponential falloff — must be expressed in the allowed
  arithmetic or kept in the renderer.
- `dump.ts` needs `Date` and `JSON` to serialise a dump, so the package carries exactly one
  declared boundary. See ADR-0011.
- The sim can never import three.js, the DOM, the server or Node built-ins. Anything the
  renderer needs must be *derived* from sim state, never stored in it.
