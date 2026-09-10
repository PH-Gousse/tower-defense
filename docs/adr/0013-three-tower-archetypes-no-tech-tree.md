# ADR-0013 — Three tower archetypes, three levels, no tech tree

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

The map this game descends from carries a large tower roster with elements, research,
upgrade paths and damage-type interactions. Reproducing it is the obvious move and the wrong
one: it is most of the content budget, most of the balance surface, and none of what makes
the game good.

## Decision

**Three archetypes only**, each answering one creep archetype:

| Tower | Answers | Shape |
|---|---|---|
| Single-target | tanks | high damage, long range |
| Splash | swarms | area damage, short range |
| Slow | runners | low damage, applies a movement slow |

Three levels each, upgraded **in place** for gold. Selling refunds a fraction of the total
invested including upgrades.

**No elements. No research. No damage types. Do not copy Warcraft 3's tower or tech system.**

## Consequences

- The counter structure is a legible 3×3: three creeps, three towers, one answer each. A new
  player can hold the whole roster in their head after one match.
- The interesting decision moves from *which tower* to *where* — which is the decision the
  maze is for. At 8 tiles wide a range-3 tower covers three passes of a serpentine at once,
  so placement is a real choice rather than uniform tiling.
- Balance surface is small enough that `balance-batch` can actually sweep it.
- Two rules exist to stop the archetypes collapsing into each other:
  - **Slow does not stack — strongest wins.** Stacking would let three cheap slows stop a
    creep dead, which makes Slow the only tower.
  - **Splash deals full damage in radius, no falloff.** Falloff would make Splash a worse
    single-target tower at every range.
- Known and unresolved: targeting picks the in-range creep nearest the exit, so towers
  permanently focus whatever is furthest along. A long-lived tank soaks every shot while
  fresh creeps walk behind it. Whether that is a feature or degenerate is a tuning question.
