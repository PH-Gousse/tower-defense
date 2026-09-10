# Game Design Document — Line Tower Wars

The single source of truth for the **rules**. Where this file and the code disagree, this
file is the intent and the code is the bug — but neither is changed silently: see
`/rule-change`.

Every statement is tagged:

- `[confirmed]` — agreed explicitly. Changing it is a decision, not a tweak.
- `[proposed]` — read off the code, or a placeholder. Needs confirmation before it hardens.
- ⚠️ **CONFLICT** — the confirmed rule and the shipped code disagree. Both are written out.
  A conflict is a bug with an issue against it, never something to resolve by editing one side.

Related: engineering rules in [`invariants.md`](invariants.md) · decisions in
[`adr/`](adr/) · constants in `packages/sim/data/*.json` and `packages/sim/src/data.ts`.

---

## 1. Match shape

- **1v1 only.** Human vs human online, or human vs AI opponent. `[confirmed]`
- **Two lanes, one per player, side by side.** Player `i` defends lane `i`. `[confirmed]`
  (`GameState.lanes`, `packages/sim/src/state.ts`)
- Both lanes are drawn at full size simultaneously — you cannot counter-pick a maze you
  cannot read. `[proposed]` (README, `packages/client/src/scene.ts`)
- **First player to zero lives loses.** `[confirmed]`
- If both players hit zero on the same tick the match is a **draw**. `[proposed]` — the
  confirmed win condition does not mention draws; the code implements `MatchResult.Draw`
  because two leaks can resolve on the same tick in different lanes
  (`step.ts` `endMatch`). Reachable in practice: every bot mirror match ends this way.
- A finished match is frozen — no tick, no commands, no movement. `[proposed]` (`step.ts`)

## 2. The lane

- **8 tiles wide × 24 tiles long**, 1 world unit per tile. `[confirmed]`
  (`GRID_W = 8`, `GRID_H = 24`, `packages/sim/src/grid.ts`)
- The lane runs **vertically**: creeps enter at the top, leave at the bottom. `[proposed]`
- **Entrance row (y=0) and exit row (y=23) are reserved** — no building on either, the
  whole row, not just the tiles that spawn and drain. `[confirmed]`
- Entrance and exit sit on **opposite sides**: entrance is `x ∈ {0,1}`, exit is
  `x ∈ {6,7}`, so a bare lane is already a ~29-tile diagonal walk rather than a 23-tile
  drop. `[proposed]` (`SPAWN_TILES`, `EXIT_TILES`)
- **A tower occupies exactly one tile.** `[confirmed]`
- Width is the maze-richness knob; length is the pace knob. Change one at a time.
  `[proposed]`

## 3. Building

Placement is refused, with the reason on screen and **before any gold moves**, when:

| Refusal | Meaning | Status |
|---|---|---|
| `OutOfBounds` | tile is off the grid | `[proposed]` |
| `Occupied` | a tower is already there | `[confirmed]` |
| `SpawnOrExit` | tile is in the entrance or exit row | `[confirmed]` |
| `WouldSealLane` | no route would remain from entrance to exit | `[confirmed]` |
| `NotEnoughGold` | cannot afford it | `[confirmed]` |

- **Sealing check is on the spawn tiles only, not on creep positions.** `[proposed]` —
  ⚠️ this differs from the confirmed rule *"placement that lands on a tile a creep
  currently occupies is refused"*. The code deliberately allows it: refusing on creep
  positions would make legality flicker as creeps move, and would let a cheap swarm send
  lock tiles out of the defender's maze. A creep with no route **teleports back to the
  entrance** instead (`moveCreeps`, `Dir.None` branch). See
  [ADR-0012](adr/0012-blocking-refusal-checks-spawn-not-creeps.md).
  **Open: confirm the code's rule, or implement the stated one.**
- Selling can only open paths, never close them, so a sell needs no reachability check.
  `[proposed]`
- Upgrading changes range and damage, never the blocked set. `[proposed]`

## 4. Towers (v1)

**Three archetypes only. Three levels each, upgraded in place for gold. No elements, no
research, no damage types. Do not copy Warcraft 3's tower or tech system.** `[confirmed]`

| Archetype | Answers | Shape | Status |
|---|---|---|---|
| Single-target | tanks | high damage, long range | `[confirmed]` |
| Splash | swarms | area damage, short range | `[confirmed]` |
| Slow | runners | low damage, applies a movement slow | `[confirmed]` |

- **Selling refunds a fraction of total gold sunk in** (base + upgrades), floored.
  `[confirmed]` that it is a fraction of the invested total; the **fraction itself is
  `[proposed]`** — see §8.
  ⚠️ Default stated as **75%**; `towers.json` ships **60%** (`sellRefund: 0.6`).
- Damage is **instant, no projectile travel** — a shot resolves in the tick it is fired.
  `[proposed]` (`fireTowers`)
- A tower targets **the in-range creep nearest the exit**, tiebroken by ascending creep id.
  `[proposed]`. Known consequence, unresolved: towers permanently focus whatever is
  furthest along, so a long-lived tank soaks every shot while fresh creeps walk behind it.
- **Slow does not stack — strongest wins.** `[proposed]` (three cheap towers stopping a
  creep dead is a different game.)
- Splash deals **full damage** to everything within `splashRadius` of the target, not
  falloff. `[proposed]`

## 5. Creeps (v1)

**Three archetypes, three tiers each. Tiers unlock on the match clock, at the same moment
for both players.** `[confirmed]`

| Archetype | Answers | Shape | Status |
|---|---|---|---|
| Swarm | splash | cheap, low HP | `[confirmed]` |
| Runner | slow | fast, low HP | `[confirmed]` |
| Tank | single-target | slow, very high HP | `[confirmed]` |

- ⚠️ **Swarm's pack size.** The confirmed rules describe swarm as *"cheap, **many per
  purchase**, low HP"* — but they also confirm *"one click = one creep (one command in the
  log)"*. Those two cannot both hold. The code resolved it toward **one creep per
  purchase** (`count: 1` for every archetype), on the argument that the map this game
  descends from queues one unit per shrine click and spamming is the intended way to mass
  send; a pack made the multiplication happen in the data where no amount of work on the
  button could reach it. Splash still has swarms to answer because five clicks still make
  five creeps. **Open: confirm one-per-purchase, or restore packs and drop "one click =
  one creep".**
- Tier N's stats are **`base × growth^N`, generated at load** — the roster is a rule, not a
  list. `[proposed]` (`expandCreeps`, `packages/sim/src/data.ts`)
- **Known gap, deliberate:** bounding the ladder at three tiers removed the property that
  used to guarantee every match ends (geometric HP growth eventually beating any maze).
  Nothing replaces it. Measured: a saturated maze needs 40 572 HP to survive one lap; the
  heaviest creep this ladder can produce is Tank III at 6 250 — short by 6.5×, permanently.
  Two players who both build past ~50 towers can sit in a match that cannot end. Bots do
  not reach it (`MAX_TOWER_TARGET = 45`). `[proposed]` — needs a match-ender decision, [issue #8](https://github.com/PH-Gousse/tower-defense/issues/8).

## 6. Sending

- **Buying a creep spawns it immediately** at the entrance row of the **opponent's** lane.
  `[confirmed]` (`spawnSend` runs inside `applyCommands`, same tick.)
- **No send queue and no pacing.** `[confirmed]` (The release queue that paced one creep
  every four ticks is gone — see [ADR-0006](adr/0006-no-send-queue.md).)
- **One click = one creep = one command in the log.** ×5 / ×10 buttons emit five / ten
  separate commands. `[confirmed]`
- **Creeps never enter the sender's own lane.** `[confirmed]` (`opponentOf`)
- The only limits on sending are **gold and tier unlock time**. `[confirmed]`, with two
  qualifications the code adds:
  - ⚠️ **`Refusal.LaneFull`** exists as a backstop when the target lane holds `MAX_CREEPS`
    (65 536). It is not a design cap — it is sized past what gold can buy in any match —
    but it *is* an in-flight cap in the type system. It refuses before the debit. Kept
    because the alternative the code used to do was take the gold, grant the income, and
    drop the creep in silence. `[proposed]`
  - ⚠️ **`Refusal.BuildPhase`**: nobody may send for the first **400 ticks (20 s)**. This
    opening build phase is not in the confirmed rules but is load-bearing — the income
    clock anchors to it (§7). `[proposed]` — needs confirming as a rule.
- Creeps arriving on the same tick are **spread backwards along the route**, not across the
  entrance, so they stay distinct instead of welding into one dot with N health bars. The
  budget is **22 distinct spawn points** before the pattern repeats. `[proposed]`
  (`spawnPointFor`, `SPAWN_PERIOD`.) A single-tick burst past 22 welds creeps together
  permanently; the bot self-limits to `MAX_SEND_BURST = 22` for this reason.

## 7. Economy

- **Each creep purchase raises the sender's income figure immediately and permanently.**
  `[confirmed]` Sending is the **only** way income grows, which is what makes turtling a
  losing strategy. `[confirmed]`
- **Every income tick the income figure is paid into the player's gold.** `[confirmed]`
  Interval is a constant, default **15 s = 300 ticks at 20 Hz** (`INCOME_EVERY_TICKS`).
  `[confirmed]` at 15 s.
- ⚠️ **The income clock starts when sending opens, not at tick 0.** `[proposed]` — not in
  the confirmed rules. The code anchors the schedule to `SEND_UNLOCK_TICKS` because a
  payout landing before anyone may send is a period the attacker can never have
  compounded; the measured effect was a cliff, not a slope (counter-picking went 12-0 → 4-8
  the moment the build phase grew long enough to swallow the first payout).
  See [ADR-0009](adr/0009-income-clock-anchored-to-send-unlock.md).
- **Bounty is paid to the lane owner on each kill.** `[confirmed]` **Nothing is paid on a
  leak.** `[confirmed]`

## 8. Leaks and looping

- When a creep reaches the exit of a lane:
  1. **The defender loses one life.** `[confirmed]`
  2. ⚠️ **The sender gains one life.** `[confirmed]` — **NOT IMPLEMENTED.** `step.ts`
     `moveCreeps` currently credits nobody, with a deliberate rationale in the code:
     *"The sender gains nothing. Lives only ever go down, for everyone. Crediting the sender
     would make each leak a 2-point swing, so a leader would compound in lives and income at
     once with nothing pushing back."* The confirmed rule overrides that. This is a real
     open bug — see [ADR-0008](adr/0008-leak-credits-the-sender.md) and [issue #7](https://github.com/PH-Gousse/tower-defense/issues/7).
     Landing it needs: the sim change, a lives *cap* decision (may lives exceed the
     starting figure?), the `hashState` consequences, and regenerated golden fixtures.
  3. The creep is placed **back at the entrance of the same lane** with its **current HP**,
     its **lap counter increments**, and it runs again. `[confirmed]`
- **No lap cap, no decay, no timeout.** Tower damage is the only thing that removes a
  creep. `[confirmed]`
- A creep with no route (walled in mid-field) **teleports to the entrance** rather than the
  placement being refused. `[proposed]` — walling a creep in then costs the trapper towers
  and achieves nothing.

## 9. Camera

- **Warcraft 3-style:** a real 3D scene, fixed high-angle perspective camera, **fixed yaw,
  zoom and pan only.** `[confirmed]`
- Pose is a single source of truth — pitch, yaw and distance — with camera position
  *derived*, so pitch/yaw/roll cannot drift whatever order events arrive in. `[proposed]`
  (`packages/client/src/render/CameraRig.ts`)
- Perspective, not orthographic. Orthographic was **rejected rather than deferred**: the
  picking path divides by `tan(fov/2)`, so an orthographic camera is a rewrite of it.
  `[proposed]`
- Shipped pose: fov 18, pitch 70 (Warcraft 3's own pitch is 56; raised with the narrowed
  fov to keep the near/far scale ratio near 1). `[proposed]`

## 10. Refusals

**Every way a command can fail is a `Refusal` reason with an on-screen message, checked
before any gold moves.** `[confirmed]`

Current enum (`packages/sim/src/step.ts`):

`None`, `OutOfBounds`, `Occupied`, `SpawnOrExit`, `WouldSealLane`, `NotEnoughGold`,
`NoTowerHere`, `AlreadyMaxLevel`, `TierLocked`, `BuildPhase`, `LaneFull`.

Naming rule: a `Refusal` names **the condition, from the player's side** — `NotEnoughGold`,
not `GoldCheckFailed`; `WouldSealLane`, not `InvalidPlacement`. `[proposed]`

⚠️ `packages/server/src/protocol.ts` carries a parallel `RefusalReason` type. The two must
agree; nothing currently enforces that. [Issue #9](https://github.com/PH-Gousse/tower-defense/issues/9).

---

## 11. Economy numbers — **all `[proposed]`**

Every figure below is a placeholder with the right *shape*, not a tuned number. Tuning is
what `/balance` and `balance-batch` exist for. Nothing here is confirmed.

Source of truth: `packages/sim/data/towers.json`, `packages/sim/data/creeps.json`, and
`packages/sim/src/data.ts` / `state.ts` for the three that are still TypeScript constants.

### Match constants

| Constant | Value | Where | Note |
|---|---|---|---|
| Tick rate | 20 Hz | `step.ts` `TICK_HZ` | `[confirmed]` — a determinism invariant, not balance |
| Starting gold | 6 000 | `data.ts` `STARTING_GOLD` | not in a JSON file yet |
| Starting income | 250 | `data.ts` `STARTING_INCOME` | not in a JSON file yet |
| Starting lives | 20 | `state.ts` `STARTING_LIVES` | not in a JSON file yet; "one bad leak is a crisis with time to respond" is the intent |
| Income interval | 300 ticks (15 s) | `state.ts` `INCOME_EVERY_TICKS` | interval `[confirmed]`, anchor `[proposed]` |
| Build phase | 400 ticks (20 s) | `creeps.json` `sendUnlockTicks` | |
| Tier unlock spacing | 6 000 ticks (5 min) | `creeps.json` `unlockEveryTicks` | tiers at 0:00 / 5:00 / 10:00 |
| Max tier | 2 (→ three tiers, 0–2) | `creeps.json` `maxTier` | |
| Sell refund | 0.60 | `towers.json` `sellRefund` | ⚠️ stated default is 0.75 |
| Max tower level | 3 | `data.ts` `MAX_LEVEL` | `[confirmed]` |

**Gold is scaled ×10 from the source table**, so a pack price can divide by its pack size
without rounding away a tenth of a card, and a half-gold bounty can exist at all. Gold is
hashed as a 32-bit integer, so sub-unit prices are unavailable at any scale.

### Towers (all `[proposed]`)

| Archetype | Lvl | Cost | Damage | Range | Cooldown | Extra |
|---|---|---|---|---|---|---|
| Single-target | 1 | 600 | 30 | 3.00 | 25 t | |
| | 2 | 900 | 55 | 3.25 | 24 t | |
| | 3 | 1 400 | 84 | 3.50 | 22 t | |
| Splash | 1 | 1 100 | 12 | 1.50 | 12 t | splash radius 1.2 |
| | 2 | 1 600 | 20 | 1.70 | 12 t | |
| | 3 | 2 400 | 32 | 1.90 | 11 t | |
| Slow | 1 | 800 | 4 | 2.25 | 10 t | slow 30%, 20 t |
| | 2 | 1 200 | 6 | 2.40 | 10 t | slow 40% |
| | 3 | 1 800 | 9 | 2.60 | 10 t | slow 50% |

Ranges were **halved** when the lane went from 40×24 horizontal to 8×24 vertical: range is
in tiles, so shrinking the board made every tower cover far more of the route without a
number changing.

### Creeps — tier 0 base (all `[proposed]`)

| Archetype | Cost | Count | HP | Speed (tiles/tick) | Income | Bounty |
|---|---|---|---|---|---|---|
| Swarm | 20 | 1 | 20 | 0.075 | 2 | 5 |
| Runner | 250 | 1 | 40 | 0.150 | 20 | 60 |
| Tank | 600 | 1 | 250 | 0.050 | 40 | 150 |

### Growth per tier (all `[proposed]`)

| Field | Multiplier | Intent |
|---|---|---|
| cost | ×5 | |
| hp | ×5 | moves with cost, so **HP per gold is flat** — buying up concentrates threat, it does not buy it more cheaply |
| income | ×5 | income per gold stays constant within an archetype |
| bounty | ×4 | grows slower than cost, so the bounty tax falls ~25% → ~15%: early sends are economy, late sends are pressure |

Speed is held constant per archetype across tiers — deliberately not drifted, because speed
is not part of the growth rule and a per-tier speed column buys a difference nobody can feel.

---

## Open confirmations

Nine things need your word before they harden. Listed again in the Phase 8 report.

1. **Sender gains a life on a leak** — confirmed, unimplemented. Needs a lives-cap decision.
2. **Swarm pack size** — one per purchase (code), or many per purchase (stated)?
3. **Sell refund** — 0.60 (code) or 0.75 (stated)?
4. **Build phase** — is the 20 s opening a confirmed rule?
5. **Income clock anchor** — tied to send-unlock (code) or to tick 0?
6. **Blocking refusal** — spawn-reachability only (code), or also refuse on occupied tiles?
7. **Draws** — is a same-tick double-zero a draw, or does someone win?
8. **Match-ender** — the bounded ladder has no guarantee a match ends. What replaces it?
9. **Every number in §11.**
