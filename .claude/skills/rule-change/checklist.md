# /rule-change checklist

## Before

- [ ] `pnpm rule-change:begin` — the constants guard is disarmed for this session only
- [ ] `git status` is clean, or the pending changes are part of this rule change
- [ ] The rule is **one** rule. Two rules cannot be bisected apart later.
- [ ] Is this a decision rather than a tweak? If so, `/decide` first, then come back.

## The four places

| Place | What moves | How to tell you missed it |
|---|---|---|
| `docs/gdd.md` | the rule, its tag, any ⚠️ CONFLICT it resolves | the GDD still describes the old behaviour |
| constants | `packages/sim/data/*.json`, or the §11 TypeScript constants | a number is hard-coded in the sim instead |
| `packages/sim` | the smallest edit implementing the rule | the rule is in the client or server instead |
| `packages/sim/test` | cases that pin the rule **and its refusals** | `pnpm test` passes with the rule reverted |

The last column is the real check. After the change, **revert the sim edit and run the
tests.** If they still pass, the tests do not pin the rule and step 5 is not done.

## Refusal paths

Every rule that can be violated needs a `Refusal`, and every `Refusal` needs a test.
Ask, for the rule you just changed:

- [ ] What is the illegal version of this action?
- [ ] Does a `Refusal` member name it, from the player's side?
- [ ] Is it checked **before any gold moves**? (`docs/invariants.md` rule 9)
- [ ] Is there a test asserting the refusal *and* that gold did not move?
- [ ] Does `packages/server/src/protocol.ts` know about it? (see issue #9)

## Verify

```sh
pnpm determinism-check     # ~3.5s
pnpm replay-verify         # ~1.2s
pnpm test                  # ~25s
pnpm typecheck && pnpm lint
bun run scripts/golden-jsc.ts   # cross-engine, if the arithmetic moved
```

## A broken replay

`replay-verify` going red is **expected** for a genuine rule change and is **a regression**
for anything else. Tell them apart before touching a fixture.

Each replay pins its own `BalanceData`, so a **balance-only** change cannot break one. If a
constants-only edit broke a replay, something else moved too — find it.

Decide which of these you are looking at:

1. **Intended.** The sim now does something different, on purpose, and the new hash is
   correct. → Regenerate, and write down *why* in the commit body and the fixture's
   `_comment`.
2. **Unintended.** The rule change had a side effect you did not predict. → **Do not
   regenerate.** You have found a bug; that is the finding.
3. **Arithmetic.** The change introduced a banned API or a float trap. → `determinism-check`
   should already be red. Fix the arithmetic, not the fixture.

To regenerate:

```sh
pnpm headless-match --seed 3 --max-ticks 4000  --out fixtures/replays/short.json
pnpm headless-match --seed 4 --max-ticks 9000  --out fixtures/replays/medium.json
pnpm headless-match --seed 1 --max-ticks 40000 --out fixtures/replays/long.json
```

The golden fixtures in `packages/sim/test/golden/` are hand-built and reach cases a bot never
plays. Regenerate them with `GOLDEN_UPDATE=1 pnpm --filter @ltw/sim test` and treat doing so
as a bigger deal than regenerating a recorded replay — they are the keystone.

## After

- [ ] `pnpm rule-change:end` — **even if you abandoned the change**
- [ ] ADR written, if this was a decision
- [ ] Issues opened for anything the change implies but did not do
- [ ] The finish block printed, including what is still `[proposed]`
