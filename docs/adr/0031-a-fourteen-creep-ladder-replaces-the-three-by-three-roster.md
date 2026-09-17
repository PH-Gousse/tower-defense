# ADR-0031 — A fourteen-creep ladder replaces the three-by-three roster

- **Date:** 2026-09-16
- **Status:** Accepted
- **Supersedes:** the creep half of [ADR-0013](0013-three-tower-archetypes-no-tech-tree.md)
  (three creep archetypes, three tiers each). ADR-0013's towers stand: three archetypes,
  three levels, no elements, research or damage types.

## Context

The user asked for "a lot more types of creeps" and fixed the first four, in player gold:

| # | Cost | Income | Bounty |
|---|---|---|---|
| 1 | 5 | 1 | 1 |
| 2 | 10 | 2 | 2 |
| 3 | 22 | 4 | 4 |
| 4 | 50 | 8 | 8 |

Ten more were to be implied from those, with names and design left to us. The roster until
now was a *rule*: three archetypes (swarm, runner, tank) × three tiers, each tier `base ×
growth^tier` with growth ×5, generated at load by `expandCreeps`. Neither the four given
creeps nor a fourteen-rung ladder fits that rule: the steps are ×2 and ×2.2 rather than ×5,
there is one creep per price rather than three, and income per gold falls along the ladder
(20% → 16%) where the rule held it flat.

The choices below were made with the user in an engineering review of the plan
(`/plan-eng-review`, same day). Each option they rejected is listed with its reason.

## Decision

**1. The roster is an explicit list of fourteen creeps in `creeps.json`**, in ladder order.
A creep's tier is its position in the list, and tier *n* unlocks at
`sendUnlockTicks + n × unlockEveryTicks`.
- *Rejected: keep a generating rule.* The user's four creeps sit on no clean rule (×2,
  ×2.2, ×2.27), so a rule needs per-creep overrides. That is a list with extra steps and
  two places to look.
- *Rejected: accept both formats.* Two load paths, both needing tests, for a format nothing
  uses.

**2. Creeps 5–14 continue the user's four**: cost ×~2.2 per step, income ×2, bounty equal to
income. Income per gold therefore falls from 20% to 6.6% up the ladder, so cheap sends are
economy and dear sends are pressure. The load asserts income per gold is **non-increasing**
along the ladder, not strictly falling, because creeps 1 and 2 tie at 20% as given.

**3. Three shapes stay, renamed for what they now mean**: **Horde** (answered by the mortar),
**Fast** (the frost shrine), **Armoured** (the guard tower). They cycle up the ladder:
Horde, Fast, Armoured, Horde, and so on.
- *Rejected: keep Balanced as the first shape's name.* With one creep per purchase, a lone
  mid-ladder creep is not a crowd, so nothing made the mortar its answer. Horde is the
  cheapest soak per gold, which makes it the thing players mass-send, which is what splash
  punishes.
- *Rejected: drop shapes.* This loses ADR-0013's legible counter structure and the bot's
  shape logic.
- A Horde income bonus was proposed and dropped, because it would have changed the incomes
  the user fixed for creeps 1 and 4.

**4. HP comes from equal threat per gold.** A creep's time inside tower range, and so the
damage it takes per lap, goes as 1/speed:

```
HP = cost(gold) × 12 × 1.1^(n-1) × threat × (0.225 / speed)
threat: Horde 0.5 · Fast 0.8 · Armoured 1.2
speed:  Horde 0.225 · Fast 0.45 · Armoured 0.15 tiles/tick (today's measured values)
```

The first draft multiplied by `speed / 0.225`, which made Fast creeps about five times the
threat per gold. An independent review caught it, and the lap measurement below confirms
the direction.

Horde was 0.6 in review and was cut to 0.5 while implementing. At 0.6 the first rung has 40
HP, which takes two hits from a level-1 mortar. The flood model then has the bot's 3:1:1 maze
of twenty towers leaking 4,824 of 5,000 Scraplings, and at 30 HP it leaks none. That
breaks the #12 claim that every creep has a maze that beats it. Twenty mortars hold the
horde at either HP.

**5. Sudden death's HP cap is derived from the roster**:
`floor((2^31 − 1) / max creep HP)`, recomputed whenever balance data is installed and
asserted to be at least ×100. Creep HP is an `Int32Array`, and the fixed ×100,000 cap was
sized for a 6,250-HP top creep.
- *Rejected: clamp HP at spawn.* It is a smaller diff, but it silently flattens sudden
  death for top creeps. A roster that makes the cap too small should fail at load instead.

**6. The bot compares creeps within a two-rung gold band** (every unlocked creep costing at
least 1/2.5 of the dearest one the bank reaches), scoring each with the flood model. Its
per-tier shape comparison would have compared one creep with itself.

## Consequences

- **Measured 2026-09-16, `lap-damage` against guard-tower mazes with sudden death off**:

  | Maze | Damage per lap at 4.5 / 9 / 3 tiles/s |
  |---|---|
  | 10 × L1 | 350 / 190 / 540 |
  | 60 × L3 | 18,225 / 8,748 / 27,000 |
  | 200 × L3, saturated | 66,771 / 31,671 / 98,145 |

  These confirm the 1/speed shape of decision 4.
- **Horde needs more mortars as it climbs.** The 3:1:1 maze one-shots only the first rung; an
  Ember Imp (400 HP) takes twenty level-1 mortar hits. "The mortar answers hordes" is a
  claim about crowds and the mortar share of a maze, not about any single rung.
- **The top of the ladder ends matches.** One Storm Drake (2.07M HP, 9 tiles/s) is about
  65 laps of a saturated board, and it costs 125,000 gold, thirteen full boards. Per
  thousand gold, creep 14 costs a defender about four times the lives creep 1 does (0.52
  against 0.12). That ratio is the 1.1^n growth, and it is the first `[retune]` lever if
  late matches end too abruptly.
- **Sudden death's cap drops from ×100,000 to ×1,036** for this roster, reached 12.25
  minutes into sudden death. No recorded fixture comes close: the longest reaches ×18.8.
- The harness `lap` tool has returned garbage since sudden death landed. It sets the tick to
  100,000, so its probe HP overflowed through the cap. It now turns sudden death off.
- **Art is now a placeholder.** Ladder positions 1–5, 6–10 and 11–14 use the old tier-1,
  tier-2 and tier-3 model of their shape, scale capped at 1.6×. Issue #51 carries the
  fourteen real assets.
- Every number here is `[proposed]` `[retune]`. The bot presets have to be re-swept, and
  the harness balance pins will be red until they are.
- Peak creep population (#14) is likely to rise: the cheapest send's income per gold
  doubled from 10% to 20%.
