# Invariants

Rules that must never break. Injected into every session by a hook. Change them only through
`/rule-change`. Never weaken a check to make something pass.

**Determinism**
1. `packages/sim` runs a fixed **20 Hz** tick. Randomness comes only from a seeded generator
   passed in explicitly — never module-level, never implicit.
2. Banned in `packages/sim`: `Math.random`, `Date`, `performance.now`, `setTimeout`/`setInterval`,
   `Promise`, `async`/`await`, `crypto`, `Math.sin/cos/tan/atan2/exp/log/pow` (and `**`), `toFixed`
   for logic, and logic depending on `JSON` key order or `Object.keys/values/entries`/`for...in`
   order. Allowed: `+ - * /`, `Math.sqrt`, `Math.floor/ceil/round/abs/min/max/trunc/sign`, `Math.imul`.
3. One declared exemption: `sim/src/dump.ts` may use `new Date()` and `JSON.parse`. It
   serialises desync dumps, is never on the `step()` path, and no replay reads its timestamp.
   A second exemption is a `/rule-change`.
4. Ordering is a determinism pin, not a style choice: commands sort by `(player, kind)`; lanes in
   index order; creeps in ascending id (stable compaction, never swap-remove); towers fire in
   tile-index order; neighbours always N, E, S, W; tiles row-major `y * GRID_W + x`; targeting
   ties break on ascending creep id.

**Isolation**
5. `packages/sim` imports nothing — no three.js, no DOM, no server, no Node built-ins, no
   sibling packages. Zero runtime dependencies, and it gains none.
6. The sim advances only through `step(prev, commands, into)`. No other code mutates sim
   state. `prev` is never written; `into` is a caller-owned buffer.

**Commands and replay**
7. Commands are the atom. Client, server and AI opponent are all just command sources; none
   is privileged over another.
8. A replay is `{ seed, commandLog }` plus the frozen `BalanceData` it ran under. Re-running it
   reproduces the final state hash bit for bit, on any engine.
9. Every way a command can fail is a `Refusal` with an on-screen message, checked **before** any
   gold moves.
10. `hashState` covers every field that defines the match. Adding a field to `GameState` without
    adding it there must fail `sim/test/hash.test.ts`.

**Balance**
11. All balance constants live in `packages/sim/data/*.json` plus `STARTING_GOLD` /
    `STARTING_INCOME` / `STARTING_LIVES`. Nothing is hard-coded elsewhere.
12. `/rule-change` moves GDD, constants and tests together. Never edit constants outside
    `/rule-change` or `/balance` acceptance. Run `/determinism-check` and `/replay-verify`
    before calling sim work done.
