# Interpreting a broken replay

## Step 1 — what actually changed

```sh
git diff --stat HEAD~1 -- packages/sim
git log --oneline -5 -- packages/sim packages/sim/data
```

| What moved | Can it break a replay? |
|---|---|
| `packages/sim/data/*.json` only | **No.** Each replay installs its own frozen copy. If a replay broke, look harder. |
| `packages/sim/src/*.ts` | Yes — this is the normal cause. |
| `hash.ts` | Yes, and it invalidates **every** replay at once. A field added to `hashState` moves all hashes. |
| `state.ts` (new `GameState` field) | Yes, via `hash.ts`. Expected, and needs all fixtures regenerated together. |
| nothing under `packages/sim` | Structural, or a dependency moved. Investigate before touching fixtures. |

**All replays broke at once** points at `hash.ts` or `state.ts`. **One replay broke** points
at a rule that only that match exercised — which is the fixture doing its job.

## Step 2 — narrow to the tick

```sh
pnpm state-hash --replay fixtures/replays/short.json --every 100
```

Compare against the stored `expectedHash`. Halve the interval until you have the tick, then
ask what happens on that tick — a first send, a tier unlock, a leak, an income payout.

Useful ticks: **400** sending opens · **300 + 400 = 700** first income · **6400** tier 1 ·
**12400** tier 2.

A break at exactly one of those is a strong hint about which rule moved.

## Step 3 — the verdict

### Expected

A `/rule-change` is in flight and deliberately altered behaviour. The new hash is correct.

Regenerate, and write the reason in **two** places — the commit body and the fixture's
`_comment` field. A fixture whose regeneration has no recorded reason is a fixture nobody
can audit later.

```sh
pnpm headless-match --seed 3 --max-ticks 4000  --out fixtures/replays/short.json
pnpm headless-match --seed 4 --max-ticks 9000  --out fixtures/replays/medium.json
pnpm headless-match --seed 1 --max-ticks 40000 --out fixtures/replays/long.json
```

Golden fixtures: `GOLDEN_UPDATE=1 pnpm --filter @ltw/sim test`, then commit the printed
hashes. Treat this as a bigger deal — they are hand-built and pin cases the bots never
reach.

### Unexpected

Nothing in this change should have altered the sim, and yet it did.

**Stop. Do not regenerate.** The break is the finding, and it is exactly what the fixtures
exist to produce. Report it with the tick, the fields that differ, and the commit that
introduced it.

The failure this guards against is real and cheap to fall into: a red fixture is annoying,
regenerating makes it green, and the regression ships with a fixture that now certifies it.

### Structural

Unreadable JSON, or no `data` field. Not a sim problem. A replay without frozen balance data
cannot be verified at all and must be re-recorded rather than trusted.
