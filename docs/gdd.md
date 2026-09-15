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
- Both lanes are drawn side by side at the same scale and the camera can pan to either —
  you cannot counter-pick a maze you cannot read. The frame holds 20 rows of them; you
  pan or jump to the rest (§9). `[proposed]`
- **First player to zero lives loses.** `[confirmed]`
- If both players hit zero on the same tick the match is a **draw**. `[proposed]` — the
  confirmed win condition does not mention draws; the code implements `MatchResult.Draw`
  because two leaks can resolve on the same tick in different lanes
  (`step.ts` `endMatch`). Reachable in practice: every bot mirror match ends this way.
- A finished match is frozen — no tick, no commands, no movement. `[proposed]` (`step.ts`)

## 2. The lane

The **tile** is the creep tile and the only unit the sim speaks. See
[ADR-0019](adr/0019-lane-is-16-wide-with-2x2-towers-and-1-tile-creeps.md).

- **A creep occupies 1 × 1 tile. A tower occupies 2 × 2 tiles.** No code path may assume the
  two are the same size. `[confirmed]` (`TOWER_SIZE`, `CREEP_SIZE`, `packages/sim/src/grid.ts`)
- **The lane is 17 tiles wide** — a full row is 8 towers and leaves **one spare column**,
  one creep wide, so a straight wall is a half-slot by itself and its gap is on whichever
  side the wall does not touch. **`[proposed]`** 2026-09-15, one more than ADR-0019's
  confirmed 16 ([ADR-0027](adr/0027-lane-is-17-wide-and-100-rows.md)). (`LANE_WIDTH`,
  `TOWERS_ACROSS`, `SPARE_TILES`)
- The lane runs **vertically**: creeps enter at the top, leave at the bottom. `[confirmed]`
- Along its length the lane has three zones, in the order creeps meet them:
  - a **spawn zone** of `SPAWN_ROWS = 10` rows, where creeps appear. Not buildable. `[confirmed]`
  - a **buildable area** of `LANE_LENGTH` rows. **100 `[proposed]`** — halved from 200 on
    2026-09-15 ([ADR-0027](adr/0027-lane-is-17-wide-and-100-rows.md)): the Warcraft
    3-length lane was too long to play. Nothing in the code depends on the exact figure,
    but every lap time scales with it.
  - an **exit zone** of `EXIT_ROWS = 3` rows. A creep whose position enters it has leaked.
    Not buildable. `[confirmed]`
- Two lanes sit side by side, `LANE_GAP` tiles apart. **4 `[proposed]`**
- **Towers anchor on the 1-tile grid.** A tower's anchor is any tile such that its 2 × 2
  footprint lies inside the buildable area; the footprint is derived from the anchor and the
  per-cell occupancy grid is a cache of it, never the source of truth. Two towers offset by
  one tile leave a corridor one creep wide — the **half-slot** — and that is the mazing
  skill of the game. `[confirmed]` ([ADR-0020](adr/0020-towers-anchor-on-the-creep-tile-grid.md))
  On the 17-wide lane a full row gets the same corridor for free from the spare column;
  the offset still matters anywhere a wall does not reach an edge, and it is what seals:
  a tower directly under a full row's open column, sharing an edge with the row's last
  tower, is `WouldSealLane`; one row further down it is a corridor.
- **The camera cannot show the whole lane.** The player scrolls. `[confirmed]` — see §9.
- Width is the maze-richness knob; length is the pace knob. Change one at a time.
  `[proposed]`

Superseded: the 8 × 24 lane with one-tile towers, a reserved entrance row and exit row, and
entrance and exit on opposite sides. Recorded in ADR-0019.

## 3. Building

Placement is refused, with the reason on screen and **before any gold moves**, checked in
this order:

| Refusal | Meaning | Status |
|---|---|---|
| `NotEnoughGold` | cannot afford it | `[confirmed]` |
| `OutOfBounds` | the 2 × 2 footprint is not fully inside the lane | `[confirmed]` |
| `InSpawnZone` | any footprint cell is in the spawn zone | `[confirmed]` |
| `InExitZone` | any footprint cell is in the exit zone | `[confirmed]` |
| `OverlapsTower` | any footprint cell already belongs to a tower | `[confirmed]` |
| `CreepOnFootprint` | a creep's current tile is inside the footprint | `[confirmed]` — [ADR-0023](adr/0023-placement-on-a-creep-is-refused.md) |
| `WouldSealLane` | no route of empty tiles would remain from the spawn zone to the exit zone | `[confirmed]` |

- **The block check is 4-neighbour connectivity over empty 1-tile cells**, from the exit
  zone, with the candidate footprint occupied. Creeps are one tile, so a 1-wide gap is
  passable and two towers touching only at a corner seal the diagonal. Never weaken it to
  make a layout pass: the half-slot rule is the game. `[confirmed]`
- **The block check consults the spawn zone, not creep positions.** A creep stranded by a
  legal placement elsewhere (a pocket sealed while it stood inside) is placed back in the
  spawn zone, keeping its HP and lap count. `[confirmed]`
  ([ADR-0012](adr/0012-blocking-refusal-checks-spawn-not-creeps.md), first half.)
- **A placement on a creep is refused, not allowed.** On the old 24-row lane a tower placed
  on a creep sent it back to the spawn, which cost the attacker fifteen seconds; on this
  lane it would cost 70–200 s for 240 gold of tower, cheaper than the creep. The build
  ghost shows blocked-by-creep as a third state, distinct from illegal. `[confirmed]`
  ([ADR-0023](adr/0023-placement-on-a-creep-is-refused.md), superseding the second half of
  ADR-0012.)
- Upgrade and sell address a tower by **any tile of its footprint**. `[proposed]`
- Selling can only open paths, never close them, so a sell needs no reachability check.
  `[proposed]`
- Upgrading changes range and damage, never the blocked set. `[proposed]`
- **Tower range is measured from the footprint centre.** `[confirmed]`

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
- **Sudden death guarantees the match ends.** From `suddenDeathTick` the HP of every creep
  *spawned* is multiplied by `suddenDeathGrowth` once per income period, compounding — the
  guarantee the twenty-tier ladder gave and the three-tier one lost. Sized `[proposed]`
  `[retune]` at 15:00 and ×1.15 per 15 s: Tank III (6 250 HP) passes the 81 000 a
  30-tower level-3 maze needs 4.6 minutes in and the 415 000 a 120-tower one needs 7.5
  minutes in, so no maze on this lane survives past about 23 minutes. Creeps already on
  the board keep the HP they spawned with. [ADR-0026](adr/0026-sudden-death-on-the-clock-ends-every-match.md),
  closes [issue #8](https://github.com/PH-Gousse/tower-defense/issues/8).

## 6. Sending

- **Buying a creep spawns it immediately** in the spawn zone of the **opponent's** lane.
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
- **Creeps spawn spread across the whole 10 × 16 spawn zone**, at a position derived from
  the lane's release counter (column, row, and a fractional setback along the flow field),
  so a mass send arrives as a front rather than a column. The fractional setback is
  load-bearing: it is what keeps two creeps symmetric about the first gap from arriving
  together and welding. **1760 distinct points** before the pattern repeats. `[confirmed]`
  ([ADR-0022](adr/0022-spawns-spread-across-the-zone-with-a-fractional-setback.md);
  `spawnPointFor`, `SPAWN_PERIOD`.)
- **Creeps do not collide with each other.** They overlap freely; a 1-wide gap passes any
  number of them, and separation is visual only, done by the client from the creep id.
  `[confirmed]` ([ADR-0021](adr/0021-creeps-do-not-collide.md))

## 7. Economy

- **Each creep purchase raises the sender's income figure immediately and permanently.**
  `[confirmed]` Sending is the **only** way income grows, which is what makes turtling a
  losing strategy. `[confirmed]`
- **Every income tick the income figure is paid into the player's gold.** `[confirmed]`
  Interval is a constant, default **15 s = 300 ticks at 20 Hz** (`INCOME_EVERY_TICKS`).
  `[confirmed]` at 15 s.
- **Sudden death runs on the income clock.** From `suddenDeathTick` every creep spawned
  carries `suddenDeathGrowth` more HP per income period elapsed, compounding (§5,
  ADR-0026). The HUD counts down to it beside the tier clock and then shows the factor a
  send would carry. `[proposed]` sizing, `[retune]`.
- ⚠️ **The income clock starts when sending opens, not at tick 0.** `[proposed]` — not in
  the confirmed rules. The code anchors the schedule to `SEND_UNLOCK_TICKS` because a
  payout landing before anyone may send is a period the attacker can never have
  compounded; the measured effect was a cliff, not a slope (counter-picking went 12-0 → 4-8
  the moment the build phase grew long enough to swallow the first payout).
  See [ADR-0009](adr/0009-income-clock-anchored-to-send-unlock.md).
- **Bounty is paid to the lane owner on each kill.** `[confirmed]` **Nothing is paid on a
  leak.** `[confirmed]`

## 8. Leaks and looping

- When a creep's position enters an exit-zone cell — that tick, not the next:
  1. **The defender loses one life.** `[confirmed]`
  2. ⚠️ **The sender gains one life.** `[confirmed]` — **NOT IMPLEMENTED.** `step.ts`
     `moveCreeps` currently credits nobody, with a deliberate rationale in the code:
     *"The sender gains nothing. Lives only ever go down, for everyone. Crediting the sender
     would make each leak a 2-point swing, so a leader would compound in lives and income at
     once with nothing pushing back."* The confirmed rule overrides that. This is a real
     open bug — see [ADR-0008](adr/0008-leak-credits-the-sender.md) and [issue #7](https://github.com/PH-Gousse/tower-defense/issues/7).
     Landing it needs: the sim change, a lives *cap* decision (may lives exceed the
     starting figure?), the `hashState` consequences, and regenerated golden fixtures.
  3. The creep is placed **back in the spawn zone of the same lane** (same spread rule as
     a fresh spawn) with its **current HP**, its **lap counter increments**, and it runs
     again. `[confirmed]`
- **No lap cap, no decay, no timeout.** Tower damage is the only thing that removes a
  creep. `[confirmed]`
- A creep with no route (a pocket sealed while it stood inside) **is placed back in the
  spawn zone**. Placing a tower **on** a creep is refused instead — see §3. `[confirmed]`

## 9. Camera

- **Warcraft 3-style:** a real 3D scene, fixed high-angle perspective camera, **fixed yaw,
  zoom and pan only.** `[confirmed]`
- **The camera scrolls the lane; it never shows all of it.** Zoom is stated in rows in
  frame: at most **40 rows**, and a match opens on **20 `[proposed]`** with the top of your
  lane at the top of the view. Portrait viewports are width-bound: the framing backs off
  until your whole lane fits across, which lands near 35 rows on a phone. `[confirmed]`
  ([ADR-0024](adr/0024-camera-scrolls-and-zoom-caps-at-40-rows.md))
- Pan along the lane is the primary input: drag (any button, one finger on touch), arrow
  keys, edge scroll inside the usable area, and **Shift + wheel `[proposed]`**; a sideways
  wheel pans across. Plain wheel zooms. WASD stays with sending (`q w e r t y`, `d`), which
  is why the camera does not take it. `[proposed]`
- The view is clamped so it never leaves the two lanes plus a tile of margin. `[confirmed]`
- **There is no minimap.** `[confirmed]` 2026-09-15 — the lane is read by panning, the jump
  keys and the off-screen alerts. ([ADR-0029](adr/0029-no-minimap.md), superseding that
  part of ADR-0024.)
- **Jump keys `[proposed]`:** `Home` my spawn zone, `End` my exit zone, `Tab` the other lane
  at the same row, `Space` the deepest creep in my lane, then the next creep on the same lap.
- **Off-screen alerts:** an arrow at the edge of the view when a creep leaks or a tower fires
  out of sight, pointing along the lane. Leaks linger; fire is throttled. `[confirmed]`
- **Picking snaps a 2×2 footprint to the nearest grid vertex** `[proposed]`, so the ghost sits
  centred under the cursor; any cell of a footprint selects its tower. The ghost has three
  colours: legal, refused, and blocked-by-creep (a wait, not a no — ADR-0023). The refusal
  text follows the cursor as well as sitting in the HUD.
- Both lanes are always rendered and reachable by panning or `Tab`. `[confirmed]`
- Pose is a single source of truth — pitch, yaw and distance — with camera position
  *derived*, so pitch/yaw/roll cannot drift whatever order events arrive in. `[proposed]`
  (`packages/client/src/render/CameraRig.ts`)
- Perspective, not orthographic. Orthographic was **rejected rather than deferred**: the
  picking path divides by `tan(fov/2)`, so an orthographic camera is a rewrite of it.
  `[proposed]`
- Shipped pose: fov 18, pitch 70 (Warcraft 3's own pitch is 56; raised with the narrowed
  fov to keep the near/far scale ratio near 1). The zoom cap is derived from the 40-row
  limit at this pose, about 118 units, and moves with it. `[proposed]`

Superseded: "both lanes are drawn at full size simultaneously" as a framing rule (§1) — they
are both drawn, but the frame holds 20 rows of them. Recorded in ADR-0024. The minimap that
ADR-0024 added was removed two days later (ADR-0029).

## 10. Refusals

**Every way a command can fail is a `Refusal` reason with an on-screen message, checked
before any gold moves.** `[confirmed]`

Current enum (`packages/sim/src/step.ts`):

`None`, `NotEnoughGold`, `OutOfBounds`, `InSpawnZone`, `InExitZone`, `OverlapsTower`,
`CreepOnFootprint`, `WouldSealLane`, `NoTowerHere`, `AlreadyMaxLevel`, `TierLocked`,
`BuildPhase`, `LaneFull`.

Naming rule: a `Refusal` names **the condition, from the player's side** — `NotEnoughGold`,
not `GoldCheckFailed`; `WouldSealLane`, not `InvalidPlacement`. `[proposed]`

⚠️ `packages/server/src/protocol.ts` carries a parallel `RefusalReason` type. The two must
agree; nothing currently enforces that. [Issue #9](https://github.com/PH-Gousse/tower-defense/issues/9).

---

## 11. Economy numbers — **all `[proposed]` and `[retune]`**

Every figure below is a placeholder with the right *shape*, not a tuned number. Tuning is
what `/balance` and `balance-batch` exist for. Nothing here is confirmed.

**`[retune]` (ADR-0025, 2026-09-13):** the lane went from 8×24 to 16×213 with 2×2 towers
(ADR-0019). Every speed, range, income tick and tier unlock below was tuned on the old board
and is **void** until `/balance` has run on the new one. No balance finding recorded before
2026-09-13 applies. What has been done so far is a *geometric conversion*, not a tuning:
creep speed ×3, tower range ×3, splash radius ×3, everything else untouched, so every ratio
the roster was tuned on (HP per gold, gold per damage, bounty tax) survives and there is
one factor to argue about. The conversion is the original's units: its creeps move at
4.2–5.5 creep tiles/s and its towers reach 9–14 creep tiles, about three times what we
had.

Source of truth: `packages/sim/data/towers.json`, `packages/sim/data/creeps.json`, and
`packages/sim/src/data.ts` / `state.ts` for the three that are still TypeScript constants.

### Match constants

| Constant | Value | Where | Note |
|---|---|---|---|
| Tick rate | 20 Hz | `step.ts` `TICK_HZ` | `[confirmed]` — a determinism invariant, not balance |
| Starting gold | 9 000 | `data.ts` `STARTING_GOLD` | not in a JSON file yet · `[retune]` — first retune 2026-09-14, was 6 000: a first half-slot wall is eight towers on 16 tiles (#48). A longer build phase was measured first and bought nothing, because income anchors to send-unlock |
| Starting income | 250 | `data.ts` `STARTING_INCOME` | not in a JSON file yet · `[retune]` |
| Starting lives | 20 | `state.ts` `STARTING_LIVES` | not in a JSON file yet; "one bad leak is a crisis with time to respond" is the intent |
| Income interval | 300 ticks (15 s) | `state.ts` `INCOME_EVERY_TICKS` | interval `[confirmed]` on the old board, now `[retune]`: 3 to 5 payouts per bare lap instead of 1 or 2; anchor `[proposed]` |
| Build phase | 400 ticks (20 s) | `creeps.json` `sendUnlockTicks` | `[retune]` — a 16-wide opening maze costs more than an 8-wide one |
| Tier unlock spacing | 6 000 ticks (5 min) | `creeps.json` `unlockEveryTicks` | tiers at 0:00 / 5:00 / 10:00 · `[retune]` — measured 2026-09-15 against 4 500 and 3 000 under sudden death and kept: 6 000 gives the shortest matches (median 22 156 ticks), the lowest peak (943 creeps) and the only monotone ladder of the three; 3 000 breaks the ladder (#48) |
| Sudden death start | 18 000 ticks (15:00) | `creeps.json` `suddenDeathTick` | ADR-0026; one unlock interval after the last tier · `[retune]` |
| Sudden death growth | ×1.15 per income period | `creeps.json` `suddenDeathGrowth` | compounding, applied to HP at spawn · `[retune]` |
| Max tier | 2 (→ three tiers, 0–2) | `creeps.json` `maxTier` | |
| Sell refund | 0.60 | `towers.json` `sellRefund` | ⚠️ stated default is 0.75 |
| Max tower level | 3 | `data.ts` `MAX_LEVEL` | `[confirmed]` |

**Gold is scaled ×10 from the source table**, so a pack price can divide by its pack size
without rounding away a tenth of a card, and a half-gold bounty can exist at all. Gold is
hashed as a 32-bit integer, so sub-unit prices are unavailable at any scale.

### Towers (all `[proposed]` `[retune]`)

| Archetype | Lvl | Cost | Damage | Range | Cooldown | Extra |
|---|---|---|---|---|---|---|
| Single-target | 1 | 600 | 30 | 9.00 | 25 t | |
| | 2 | 900 | 55 | 9.75 | 24 t | |
| | 3 | 1 400 | 84 | 10.50 | 22 t | |
| Splash | 1 | 1 100 | 12 | 4.50 | 12 t | splash radius 1.8 (was 3.6; second retune 2026-09-14, #12) |
| | 2 | 1 600 | 20 | 5.10 | 12 t | |
| | 3 | 2 400 | 32 | 5.70 | 11 t | |
| Slow | 1 | 800 | 4 | 6.75 | 10 t | slow 30%, 20 t |
| | 2 | 1 200 | 6 | 7.20 | 10 t | slow 40% |
| | 3 | 1 800 | 9 | 7.80 | 10 t | slow 50% |

Range is in tiles from the footprint centre, so it moves with the board. It was **halved**
when the lane went from 40×24 horizontal to 8×24 vertical (a range-6 single-target covered
three quarters of an 8-wide lane), and **tripled** when the lane went to 16 wide with 2×2
towers (ADR-0025): at 1.5–3.5 tiles a tower's range was shorter than the tower, and the
original's 600–900 units are 9–14 creep tiles. A level-1 single-target now covers a little
over half the lane's width from a wall; a level-1 splash reaches the corridor on either
side of its own wall and no further.

The splash radius did **not** keep the ×3. A blast is an area over a crowd, and creeps do
not collide (ADR-0021), so they pack far denser than the original's: at 3.6 tiles a
mortar in every five towers held 60 000 gold of swarm to zero leaks, and sending swarm was
never pressure. At 1.8 a swarm flood beats a single-target maze, a mortar-heavy maze still
holds it, and tanks and runners get through the mortar-heavy maze that swarm cannot — the
3×3 the design rests on, measured 2026-09-14 (issue #12).

### Creeps — tier 0 base (all `[proposed]` `[retune]`)

| Archetype | Cost | Count | HP | Speed (tiles/tick) | Speed (tiles/s) | Bare lap (213 rows) | Income | Bounty |
|---|---|---|---|---|---|---|---|---|
| Swarm | 20 | 1 | 20 | 0.225 | 4.5 | 47 s | 2 | 5 |
| Runner | 250 | 1 | 40 | 0.450 | 9.0 | 24 s | 20 | 60 |
| Tank | 600 | 1 | 250 | 0.150 | 3.0 | 71 s | 40 | 150 |

Speeds are ×3 the old 0.075 / 0.150 / 0.050 (ADR-0025). Before the conversion a swarm's bare
lap on the 213-row lane was 142 s, nine income payouts; a full half-slot maze may still take
several minutes a lap, which is why the tier clock and the income interval are the expected
first `/balance` proposals rather than the speeds.

### Growth per tier (all `[proposed]` `[retune]`)

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
6. ~~Blocking refusal~~ — resolved by ADR-0023: refuse on a creep-occupied footprint.
7. **Draws** — is a same-tick double-zero a draw, or does someone win?
8. ~~Match-ender~~ — resolved by ADR-0026: sudden death on the clock. Its sizing (15:00, ×1.15 per period) is `[proposed]`.
9. **Every number in §11.**
