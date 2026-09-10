# ADR-0016 — The bot reads the board with a flood model, and only for defence

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

The bot (ADR-0005) read the board as two words: the opponent's maze was "mostly
single-target / splash / slow", answered from a three-row table of what to send; its own
lane was "mostly swarm / runner / tank", answered from a table of what to build. Measured, only
the send half ever helped, and the bot could not see a leak coming — it reinforced only after
a creep had already lapped.

Before changing anything the sim was measured under a stream of sends, and the result
overturned the premise the tables were built on:

- **Leaks come from floods, not waves.** No single wave the economy can buy survives a lap
  of a six-tower maze. What leaks is a lane filling faster than its towers empty it.
- **Single-target fire is nearly irrelevant to a flood.** Twenty guard towers killed 122 of
  880 streamed tanks; the survivors carried 22 damage each.
- **Splash is the answer to a flood.** Four mortars alone killed 794 of the same 880 tanks,
  and every one of 2,596 streamed swarm.
- **Maze shape was already near the best this lane allows.** A greedy "longest walk per
  tile" placement stalls at 43 tiles; the tight serpentine reaches 71 with 17% more damage
  per tower than the three-row serpentine the bot ships with.

## Decision

`packages/sim/src/threat.ts` estimates how many creeps a lane's population leaks per lap:
per tower, route tiles in range widened by how far the crowd stretches give firing time and
shots; splash comes off every creep; everything else kills one creep at a time, shared by
headcount. It is calibrated against the streamed measurements above and pinned by
`test/threat.test.ts` on its shape, not its digits.

The bot uses it in front of its existing loop, as the default `reader: 'estimate'`:

1. **Lethal:** a wave predicted to take the opponent's remaining lives is sent immediately,
   whatever phase the bot is in.
2. **Predictive defence:** when the flood already in its lane is predicted to leak, the bot
   spends this decision on whichever affordable build or upgrade the model says stops the most
   leaks per gold — costed through an override, without touching state — and otherwise plays
   as before.

The table reader stays selectable (`reader: 'table'`) so the comparison remains runnable.
The default maze template does **not** change; see the consequences for why the stronger one
is held back.

## Consequences

- **Measured, both seats, 30,000-tick ceiling.** Estimate vs table on the same template and
  ratio: 4-0-2 at easy and normal, 2-0-4 at hard (the hard pair on template 0 is a mutual
  collapse for either reader); the estimating bot never loses to the table one. The harness
  round robin still finds the ladder transitive and decisive and every mirror a draw, so
  `sendRatio` still means what ADR-0005 says it means.
- **The tight serpentine is the better maze and is deliberately not the default.** The same bot
  on template 1 beats itself on template 0 six matches out of six, 20 lives to 0, and the new
  reader on template 1 beats the old default 6-0 at every difficulty. But two equal defenders
  on it stall: the easy mirror runs 22.7 minutes with no life lost until minute 18 and peaks at
  2,620 creeps, against the harness's 20-minute shape pin and the 500-creep render budget.
  That is issue #8 — the bounded ladder has no guarantee a match ends — made visible by a
  better defence. The template can ship the day the ladder has a valve.
- **Sends are not chosen by the model, and that is a measured rejection.** Picking the wave
  predicted to leak most, sent every decision, lost 0-4 to the table's bank-and-burst rhythm:
  it dribbled the cheapest creep between income lumps where the table waited and sent the
  heaviest tier as one wave. The table's send rule stays, with the table's counter-pick.
- **The bot never holds gold for a fix it cannot afford.** Tried; holding also stalled the
  ordinary build branch, and a hard bot with a thin maze died in four minutes with 600 gold in
  hand.
- **Still a command source, still pure.** No rule changed: `step()` is untouched, the bot
  reads two arrays and a route and emits commands. No replay moved, no golden fixture changed,
  no seed is consumed. The determinism check and replay verification pass unchanged.
- **The model is a heuristic and stays one.** It ignores where a creep is when a tower fires,
  focus-fire order and overkill. Its one fitted constant, `SPREAD`, carries its fitting on it.
  A future rule change that alters targeting or splash should re-run
  `pnpm --filter @ltw/harness flood`, which streams creeps at a maze and prints the model's
  prediction beside what the sim did, before trusting the bot's defence.
- **Template 2 ("posts") is known bad** — it loses 0-6 in under two minutes — and is kept only
  so the harness can keep saying so.
- **Splash is the flood answer and the fixed 3:1:1 mix underweights it.** The bot's opening now
  gets corrected by the model as floods arrive, which is why it defends better without any rule
  change. For a human reading this: build mortars against mass sends.
