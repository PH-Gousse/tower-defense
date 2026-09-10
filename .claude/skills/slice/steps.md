# Running a slice

## 1. The issue

```sh
gh issue view <n>
gh issue view <n> --comments
```

Before writing anything, answer:

- What does a player see that they could not see before?
- Which rule does this rest on, and is that rule `[confirmed]` or `[proposed]`?
- Is there a decision hiding in here? If two reasonable implementations satisfy the issue,
  **stop and run `/decide`**. Building one makes the choice silently.

## 2. The rules

Read every `docs/gdd.md` section the issue touches, and the ADRs they cite.

Quote the rule back in your first message. If the GDD is vague, or the issue and the GDD
disagree, that is a finding — raise it now. The GDD is authoritative (`CLAUDE.md`), so a
disagreement means either the issue is wrong or the GDD needs a `/rule-change`.

Watch for `[proposed]` tags. Implementing against a proposed value is fine; the value stays
proposed, and your PR summary says so.

## 3. The test list, first

Write names and assertions before any implementation. A test list written afterwards
describes what the code does; one written first describes what the rule says.

For each behaviour:

- [ ] the legal case
- [ ] the boundary (zero, one, max, exactly-enough-gold)
- [ ] **every refusal path**, and that **no gold moved** on refusal
- [ ] the determinism angle: does this add state? Then `hashState` must cover it, and
      `sim/test/hash.test.ts` must fail without it.

Delegate to the `test-author` agent if the list is long. It writes tests only.

## 4. Sim

```
packages/sim/src/     the rule
packages/sim/data/    constants — ONLY via /rule-change
packages/sim/test/    the list from step 3
```

- The smallest change that implements the rule.
- New `GameState` field? Add it to `cloneState` **and** `hashState`, or a desync becomes
  invisible.
- New `Refusal`? Name the condition from the player's side, and check it before gold moves.
- Nothing imported. `packages/sim` imports nothing (`docs/invariants.md` rule 5).

Run `pnpm determinism-check` as soon as the sim compiles, not at the end.

## 5. Server

Only if commands or refusals changed.

- `protocol.ts` — a new `Refusal` needs a counterpart (issue #9)
- `wire.ts` — a new command field needs shape validation, and possibly a
  `PROTOCOL_VERSION` bump
- `room.ts` — ordering and seating rules
- Run `/netcode-review` on the diff.

## 6. Client

- Derive from sim state; never mutate it.
- Read sim state inside the `lastSyncedTick` gate — the sim is 20Hz and the renderer is not.
- A new refusal needs an on-screen message. "Every way a command can fail is a `Refusal`
  with an on-screen message" (`docs/invariants.md` rule 9) is not satisfied by an enum
  member alone.
- No per-frame allocation in the render loop.

## 7. Checks

```sh
pnpm test && pnpm typecheck && pnpm lint
pnpm determinism-check
pnpm replay-verify
```

A red `replay-verify` after a **feature** (rather than a rule change) is a regression. Do not
regenerate — run `/replay-verify` and interpret it.

## 8. The PR summary

```markdown
## <what a player can now do>

Closes #<n>

### The rule
<quoted from docs/gdd.md, with its [confirmed]/[proposed] tag>

### Changed
- sim: <files — what rule now lives there>
- server: <files, or "unchanged">
- client: <files>

### Tests
<n added, n updated — including which refusal paths are pinned>

### Verified
test <n> · typecheck · lint · determinism-check <n configs> · replay-verify <n/n>

### Not done
<in-scope work left, still-[proposed] values relied on, issues opened>
```

Commit format is `type: what changed, in prose, lowercase, no full stop` — see `CLAUDE.md`.
No AI co-author trailer.
