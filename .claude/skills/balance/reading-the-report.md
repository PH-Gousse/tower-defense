# Reading a balance report

## Head to head, not win rate

```
easy vs normal     0-2-1
normal vs hard     1-1-1
hard vs easy       1-1-1
```

Aggregate win rate depends on the draw; head-to-head does not. A healthy ladder is
**monotone** — hard beats normal beats easy — with **every mirror a draw**, which also
proves the sim gives neither seat an edge.

The above is not healthy: `hard vs easy` should not be tied. See issue #13.

If the presets produce the same result everywhere, check the tick count first. Both seats are
gold-constrained for roughly the first 3,500 ticks, so `sendRatio` has nothing to ration and
difficulty is close to cosmetic. A ladder measured entirely inside that window is measuring
nothing.

## The degenerate flag

Fires when one creep archetype is the winner's main send in more than 70% of decided
matches. It groups by archetype, not tier — "Swarm II winning" and "Swarm winning" are the
same finding about the same card.

The 3×3 counter structure (`docs/gdd.md` §4-5) says each creep has one tower answer. If one
card wins regardless, either that structure is not working or the card is mispriced.

Cross-check against `pnpm --filter @ltw/harness roster`, which prints HP-per-gold and
income-per-gold. A card that leads on **both** axes needs no strategy to dominate, and that
is a pricing bug rather than a design one.

## Match length

| Reading | Means |
|---|---|
| median far below p90 | a few matches run very long — check whether they hit the ceiling |
| "hit the ceiling" > 0 | matches that could not end. Issue #8, as data. |
| many draws | mirrors, which are draws by construction. Not a finding on its own. |

## Income curve

Income only grows by sending (`docs/gdd.md` §7), so the curve is a direct read on how much
attacking is happening.

- **Flat** — turtling. The economy is not rewarding aggression, or the bots cannot afford to
  send.
- **Exponential late** — compounding is working. Check it is not compounding so hard that
  the last two minutes decide everything.
- **Two seats far apart** — one player was priced out early and never recovered.

## Lap gaps

Ticks between consecutive leaks. This is the pressure a leaked creep actually applies; the
tick a leak lands on tells you nothing alone.

A median of 0-1 ticks means leaks arrive in **bursts** — many creeps completing a lap
together — and the median is then meaningless. Read p90 instead, and consider that a mass
send is arriving as one wave and lapping as one wave.

## Proposing a change

For each of your at-most-three:

```
<CONSTANT>  <file>
  now:      <value>
  propose:  <value>
  evidence: <the line from the report>
  expect:   <what should move, and by roughly how much>
  risk:     <what else this touches>
```

Prefer one constant at a time. Two moved together cannot be attributed. If the evidence
supports "measure something else first" rather than a change, propose **that** — a report
that produces no change is a legitimate outcome and a better one than a guess.
