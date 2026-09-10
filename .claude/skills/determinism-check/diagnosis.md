# Diagnosing a determinism failure

Two runs of the same match in one process parted. That is a stronger signal than a
cross-engine mismatch: the arithmetic is identical, so the cause is **state or order**.

Check in this sequence — it is ordered by how often each is the answer.

## 1. Hidden state

A module-level `let` that survives between runs, so run two starts where run one finished.

```sh
grep -rn "^let \|^const .* = new Map\|^const .* = new Set" packages/sim/src/
```

`packages/sim/src/step.ts` legitimately holds `stepScratch` and `hash` at module level. Both
are **write-before-read scratch buffers** — every field is overwritten before it is read. The
moment one is read before being written, it is state, and this is the failure.

`data.ts` holds `let` bindings for balance data on purpose (`installBalanceData`). A test
that installs fixture data and does not restore it will produce exactly this symptom.

**Fix:** make the buffer write-before-read, or move it into the call.

## 2. Iteration order

A `Map`, `Set`, or object walked instead of an indexed array.

```sh
grep -rn "for (const .* of .*\.\(keys\|values\|entries\)\|\.forEach(" packages/sim/src/
```

`docs/invariants.md` rule 4 lists every ordering pin. The likely breaks:

- commands not sorted by `(player, kind)` before apply
- `removeDead` switched to swap-remove (it must be a **stable** compaction — creep id order
  is what targeting ties break on)
- a tower loop not in tile-index order
- neighbour order not N, E, S, W

**Fix:** restore the pin. Do not "sort the output" — the order must be right during the
walk, because the walk mutates.

## 3. A banned API the scan missed

The scan is a regex over source text and is deliberately the crude half.

```sh
pnpm banned-api-scan
```

If the replay half is red and the scan is green, and causes 1, 2 and 4 are ruled out, **the
scan has a hole**. Report it as a scanner bug and add the rule to
`packages/harness/tools/lib/scan.ts`. Do not add an exemption for the calling file.

## 4. A float trap

`hashState` throws on `NaN` and normalises `-0`, so these surface as a thrown error or a
hash difference rather than as wrong gameplay.

- **NaN** — a `0/0` somewhere. The throw names the field.
- **-0** — normalised in the hasher, so it cannot desync the hash, but it *can* change a
  comparison upstream. Look for `x < 0` where `x` may be `-0`.
- **Precision** — only `+ - * / sqrt` are exact. Anything else is cause 3 wearing a disguise.

**Fix:** the arithmetic, never the hasher's tolerance. The hasher has no tolerance and must
not gain one.

## Bisecting

```sh
pnpm state-hash --replay fixtures/replays/short.json --every 100
```

Narrow to the tick, then diff the two states field by field at that tick. `hashState` walks
fields in declared order, so the first field that differs is usually the one to look at.
