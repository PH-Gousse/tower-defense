# The decision card

This is the repo's existing idiom — lettered options, one marked CHOSEN, and every rejection
carrying a reason you could argue with. See "Approaches Considered" in
`docs/designs/line-tower-wars-browser-duel.md` for the original.

## Card

```markdown
## Decision: <the question, as one sentence>

<One paragraph of context: what forces the choice now, and what breaks if it is deferred.>

### A: <name>
✅ <concrete upside>
✅ <concrete upside>
❌ <concrete cost>
Completeness: <0-100>% — <what is unknown, and what would resolve it>

### B: <name>
✅ …
❌ …
Completeness: <0-100>%

### C: <name>  (optional, max 4 total)

---

**Recommendation: <letter>.**

<Two or three sentences. Lead with the reason, not the conclusion. Name the thing that
would change your mind.>

**Touches:** GDD <sections> · constants <files/names> · code <paths>
**Rule change?** <yes — needs /rule-change | no — engineering only>
```

## Completeness score

What fraction of what you would need to be confident do you actually have.

| Score | Means |
|---|---|
| 90-100% | Measured, or forced by something already decided. |
| 60-89% | Reasoned from the code, not measured. Name what you would measure. |
| 30-59% | Judgement. Say whose, and on what basis. |
| < 30% | A guess. Say so, and say what the cheapest experiment is. |

A recommendation built on a 40% option must say that in the recommendation, not only in the
score. Two options at 40% mean the honest answer is "measure first" — recommend that.

## ADR template

Write on acceptance only. `docs/adr/NNNN-<kebab-title>.md`, next free number.

```markdown
# ADR-NNNN — <title>

- **Date:** YYYY-MM-DD
- **Status:** Accepted

## Context

<Why the choice existed. The forces, not the answer. A reader in a year should be able to
tell whether those forces still hold.>

## Decision

<What was decided, in the imperative. Include the rejected options and the reason each was
rejected — a decision without its alternatives cannot be revisited, only re-argued.>

## Consequences

<What this makes easy, what it makes hard, and what it forecloses. Include the costs you
accepted knowingly. If something is unresolved, say so here rather than leaving it out.>
```

Status vocabulary is in `docs/adr/README.md`. If the code does not yet match the decision,
the status is **Accepted — not implemented** and it needs an issue, not a silent gap.
