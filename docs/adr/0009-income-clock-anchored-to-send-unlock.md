# ADR-0009 — The income clock starts when sending opens

- **Date:** 2026-09-10
- **Status:** Accepted — `[proposed]` in the GDD, pending confirmation

## Context

Income is paid in a lump every 300 ticks (15 s). The opening build phase blocks all sending
for the first 400 ticks (20 s), so a player can lay a maze without a wave already walking it.

With the income schedule anchored at tick 0, the first payout lands at tick 300 — *inside*
the build phase, before anybody may send.

Income only grows by sending. So a payout that lands before sending opens is a period the
attacker can never have compounded, and it is pure defensive subsidy.

## Decision

Anchor the income schedule to `SEND_UNLOCK_TICKS`, not to tick 0. The first payout lands one
full interval after sending opens.

## Consequences

- Measured effect was a **cliff, not a slope**: counter-picking against the fixed-template
  bot went from 12-0 to 4-8 the moment the build phase grew long enough to swallow the first
  payout. The discontinuity sat exactly at the tick where the first send stopped preceding
  the first income. Anchoring keeps the two in the order the economy was tuned around,
  whatever length the build phase takes.
- The build phase length becomes a free parameter again — it can be tuned for feel without
  silently retuning the economy.
- Two constants are now coupled: changing `sendUnlockTicks` moves every income tick in the
  match. That coupling is deliberate but non-obvious, and is why this is written down.
- The confirmed rules say only "every income tick the income figure is paid". They do not
  say when the clock starts. **Needs confirmation.**
