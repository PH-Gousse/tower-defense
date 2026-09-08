# TODOS

Deferred work from the CEO review on 2026-09-07. Full reasoning in
`docs/designs/line-tower-wars-browser-duel.md` and
`~/.gstack/projects/PH-Gousse-tower-defense/ceo-plans/2026-09-07-line-tower-wars.md`.

Nothing here blocks v1 **except the P0 below**, which the harness found at step 7.
Each other item names the trigger that should make you pick it up.

---

## P0 — RESOLVED at step 8

### ~~Defence outscales offence: matches that cannot end~~ — fixed
Below a 0.2 spend ratio, matches used to run forever: both sides reached 20,000 income and
1,800 sends across 33 minutes and stayed on 11 lives. Every spend ratio from 0.1 to 0.8 now
resolves.

The cause was structural, not a number being wrong. Creep power was a finite list of six while
tower power grew with the board, and the board's lap damage is bounded but large — measured at
~157,000 for 136 level-3 towers. A ladder that stops short leaves a maze nothing can break.
Two changes fixed it:

- **The roster is a growth rule, not a list.** Tier N is base × growth^N, generated to tier 20,
  so creep HP passes any bounded maze eventually and somebody always loses.
- **HP per gold rises as you buy up** (`growth.hp` 2.4 > `growth.cost` 2.0). Towers are
  permanent and creeps die once, so a tower fires on every lap for the rest of the match while
  a creep pays once. Measured at tick 24,000: a 7,900g maze dealt 128,861 damage per lap,
  about 16x the HP the same gold buys in creeps. A flat or falling HP-per-gold curve loses to
  any maze, forever.

The instrument that found it is `pnpm --filter @ltw/harness lap`, which measures HP-to-survive
per maze by running probe creeps through the real simulation rather than modelling damage.

---

## P0 — the next one

### ~~Tower range was still tuned for the 40-wide lane~~ — fixed by halving it
The lane turned vertical and shrank to **8 × 24**. Geometry only — not one balance number
changed — but the balance moved anyway, because tower *range* is measured in tiles and the board
lost 80% of its cells. A range-6 single-target covered three quarters of the lane's width.
Towers came out roughly twice as gold-efficient, and the step-8 fixes for "defence outscales
offence" and "the match is too long" both regressed part of the way back.

Every range halved (single 6.0/6.5/7.0 → 3.0/3.25/3.5, splash 3.0/3.4/3.8 → 1.5/1.7/1.9, slow
4.5/4.8/5.2 → 2.25/2.4/2.6), which restored the old board's shape almost exactly. Mirror
bot-vs-bot, `pnpm --filter @ltw/harness start`:

|                    | 40 × 24, range 6 | 8 × 24, range 6 | 8 × 24, range 3 |
|--------------------|------------------|-----------------|-----------------|
| match length       | 10,478 ticks (8.7 min) | 13,820 (11.5 min) | **10,356 (8.6 min)** |
| first life lost    | ~minute 4        | ~minute 8       | **~minute 3**   |
| final income       | 2,731            | 10,017,920      | **2,731**       |
| sends per player   | 10               | 52              | **10**          |
| peak creeps        | 24               | 248             | **24**          |

The ten-million income was the tell: neither maze could be broken for eight minutes, so both
sides climbed the tier ladder until the numbers stopped meaning anything. `pnpm --filter
@ltw/harness lap` said the same thing in damage — max lap damage went 157,000 for ~39,400g on
the old board (4.0 per gold), to 113,232 for 14,500g on the new one (7.8 per gold), and now to
40,824 for 14,500g (2.8 per gold). Lower per gold than the old board, but not comparable
directly: the lane is shorter, so a creep spends fewer ticks inside any tower's circle.

The ladder stayed monotone (`has a transitive difficulty ladder` is green) and the whole harness
suite dropped from 57s to 12s, which is itself a measurement: matches resolve instead of
grinding. `towers.json` version went 1 → 2, because `versionsMatch` gates peers and two clients
whose towers deal different damage have desynced.

Two smaller things the same pass turned up, both still open:

- `measureLapDamage` and `runGauntlet` fortify from `templateAt(0)`, which is 49 tiles on this
  board, so their 50x / 80x / 120x rows all report the same number. That is honest — a
  serpentine on 8 × 24 tops out at 49 towers, which is the intended 30-60 maze size — but the
  instruments should print "saturated" rather than three identical rows. **Priority: P2.**
- `gauntlet-run` prints the maze length of the *first* defence in each row (6 towers, which does
  not lengthen the path yet), so the column reads 29 for every creep and looks broken. It should
  print per-defence or say which one it means. **Priority: P2.**


### ~~Matches are long, and the whole contest happens in the last minute~~ — fixed
Mirror matches ran 31 minutes with both players untouched on all 20 lives until minute 29, then
collapsed inside 90 seconds. Now 6-10 minutes, with lives leaving the board from minute 3.

**The cause was not the balance.** It was the bot, and the measurement that pointed at the
balance was itself misleading:

- `decidedFraction` is measured against the *winner*, so a draw reports ~100% "contested" by
  construction, whatever happened. Every mirror match is a draw. The metric said the match was
  a nail-biter for the same reason it would have said so about thirty minutes of nothing —
  which is exactly what it was describing. It is still reported, with that caveat written next
  to it; `measureShape` in the harness is what to read instead.

- The bot's maze target was tied to the tier clock, so it aimed at 45 towers from minute two
  and bought them one at a time on starting income — because income only grows by sending, and
  it was not sending, because it was still building. Twenty minutes of nothing, by
  construction. The target follows income now, which self-corrects: a poor bot wants a small
  maze, sends to get richer, then affords a bigger one.

- A second branch below the saving logic spent the savings on upgrades whenever the target
  creep was out of reach, which was most of the time. Same class of bug as the build branch
  before it, so the rule is now stated rather than the fix: **only one phase may spend.**

- The bot banked toward the heaviest creep the ladder offered, which by minute seven cost 2.3
  million gold. It now aims at what a couple of income periods will actually buy.

Data changed too, but far less than expected: cost growth 2.0 → 1.45 (the strongest single
lever on length), HP growth 2.4 → 2.0, and base income doubled. Bounty growth had to follow
cost growth — leaving it at 2.0 made each tier refund a larger share than the last, caught at
load by the wave-bounty invariant rather than by anyone noticing bad balance.

Pinned by a harness test that asserts a first life is lost inside the first three quarters of
every mirror match.

---

### ~~The difficulty ladder is not robust to balance changes~~ — better, not solved
Difficulty is the **spend ratio** now, not the reaction delay. A sweep comes out perfectly
monotone — 0.8 beats 0.65 beats 0.5 beats 0.4 beats 0.3 beats 0.2, no exceptions — where in the
old economy a higher ratio measurably played *worse*, which is why difficulty had been reduced
to latency.

That is both a stronger ladder and an explicable one: the hard bot sends more, which is what a
stronger opponent does in a game about sending. Margins are decisive (20-0 in every
off-diagonal) and every mirror draws.

Still not robust *by construction*: a future balance change could invert the ratio again, and
the only thing that would tell you is the ladder test going red.

---


### ~~Local prediction is not built~~ — built at step 11
The ghost renders on click, the path preview updates as if the tower existed, a burst of
clicks re-stamps onto free ticks rather than losing all but the first, and all three outcomes
resolve: confirmed, refused with the reason, and lost once the sim passes the stamped tick with
nothing applied. Prediction never enters the state hash, which is asserted.

---

### The relay is deployed by hand, and a deploy kills live matches
Two things to know before inviting anyone:

- `wrangler login` then `pnpm --filter @ltw/server deploy`. Build the client with
  `VITE_RELAY=wss://<your-worker>` so it points at the deploy.
- There is no reconnect in v1 and the version handshake refuses mismatched builds, so
  **deploying mid-session ends every live match**. Deploy when nobody is playing.

**Trigger:** now, before step 11 can actually happen.
**Effort:** S → S.

---


### A backgrounded tab freezes the simulation completely
Measured while verifying step 9: a Chrome tab that is not visible gets **zero** animation
frames, so `renderer.setAnimationLoop` never fires and the driver never advances. Harmless in
single player — the match simply pauses and resumes — but under lockstep it is a stall the peer
sees, and the peer cannot tell it apart from a hang.

The design already calls for showing a notice when a peer falls more than 40 ticks behind, so
the handling exists on paper. What is worth deciding at step 10 is whether a backgrounded tab
should surface something to its *own* player too, rather than silently pausing their match.

Step 10 added the `peer-stalled` overlay, so the *other* player is now told. The open question
is whether the backgrounded player should be told something too when they return, rather than
finding their match silently paused or already lost.

**Trigger:** the first time a real opponent alt-tabs mid-match.
**Effort:** S → S.

---

## P1 — do these first after v1 ships

### Ghost duels
**What:** Replay a recorded opponent's *send script* against a fresh maze. Asynchronous PvP,
not a bot.

**Why:** The bot covers "nobody is online," but a ghost is a specific real person's actual
aggression — their timing, their creep choices. Beating a friend's ghost is a social object
in a way that beating a bot is not.

**Depends on:** replay versioning (below). v1 stamps a data version into every log it writes,
which is what makes this cheap later.
**Trigger:** you have a handful of recorded matches worth replaying, and v1 is fun.
**Effort:** L (human) → M (with CC). **Priority: P1.**

### Replay + spectate URLs
**What:** Share a finished match as a URL with a scrubber. Accept a read-only third socket to
watch a live match.

**Why:** v1 has no way for a match to exist outside the two tabs that played it. For a game
with no install base, a shareable match is how it finds its next player.

**Depends on:** replay *recording*, which is itself unresolved (see below). If recording
lands in v1 this is pure UI; if not, it needs the recording path first.
**Trigger:** the same moment as ghosts; they share all the machinery.
**Effort:** M → S. **Priority: P1.**

### ~~Adaptive bot maze selection~~ — measured, and half of it was wrong
The bot counter-picks what it **sends** now: it reads the opponent's maze and answers a
single-target maze with swarm, a splash maze with tanks. Wins 10-2 against the old
fixed-template bot across six spend ratios in both seats.

Adaptive *mazing* — the half the design doc actually predicted — **loses 0-12** and is not
shipped. The fixed 3:1:1 tower mix answers all three creep shapes adequately; specialising
answers the wave that is already dying; and the bot only ever adds towers, never sells, so
every over-commitment is permanent. Doing both wins 8-4, worse than sending alone.

The modes survive as a config knob (`adaptive: 'off' | 'defence' | 'send' | 'both'`) so the
ablation stays runnable rather than being a claim in a commit message.

**Left undone:** the bot still never sells a tower, which is what would make adaptive mazing
viable — it could then correct an over-commitment instead of living with it. That is the real
prerequisite, and it is a bigger change than it looks: selling mid-match changes the maze
under creeps that are already walking it.

---


## P2 — when the thing they unblock becomes real

### Replay versioning
**What:** Pin historical data sets, or degrade gracefully, so a log recorded against
`creeps.json` v1 still replays after a balance change.

**Why:** Gates ghosts and replays. v1 stamps the version into every log but does nothing
with it.
**Trigger:** the first time a stored log fails to replay after tuning.
**Effort:** M → S. **Priority: P2.**

### Reconnect
**What:** Rejoin a match in progress, replay the log, resume. v1 ends the match on socket
close and a deploy kills every live match.

**Why:** Accidental refresh currently scores as a loss. Also the main reason to adopt
Colyseus, which brings rooms, presence and reconnect together.
**Trigger:** you lose a match you were winning because a tab closed. It will happen.
**Effort:** M → S, most of it the Colyseus migration. **Priority: P2.**

### Full balance harness (UNRESOLVED — see design doc)
**What:** Parameter sweeps, batch runs, aggregate reporting on top of the thin bot-vs-bot
runner that ships in v1.

**Why:** The thin runner answers "is this economy degenerate." The full one answers "what are
the right numbers" across thousands of matches.

**Trigger:** hand-tuning with the thin runner stops converging.
**Effort:** M → S. **Priority: P2.**

---

## P3 — real features, no urgency

### Teams (2v2 / 4v4)
**What:** Shared team life pool, per-player lanes, sends hitting the whole enemy team.

**Why:** The original WC3 format, and the social coordination is what made it addictive. The
data model is already team-shaped for exactly this — lives and gold belong to a `Team` that
currently has one member.

**Note:** the wire protocol does *not* carry the indirection. `Kind.Send` gains a
`targetTeam` field when this lands.
**Trigger:** enough people playing that four-a-side is possible.
**Effort:** L → M. **Priority: P3.**

### Creep abilities and armour types
**What:** Spell immunity, healing, armour classes, damage types — the tiered roster the spec
deliberately excludes from v1.

**Why:** v1 is a clean 3×3 rock-paper-scissors so the economy can be tuned against something
legible. Every one of these layers on without touching the core.
**Trigger:** the 3×3 is tuned and starts feeling thin.
**Effort:** M → S per ability. **Priority: P3.**

---

## UNRESOLVED — asked, not answered

Four capabilities fall out of the deterministic command log almost for free. Whether any
belong in v1 was put to the builder during the CEO review and left unanswered, so all four
sit here by **standing position**, not by decision:

- **Replay recording + object storage (R2/S3), server as recorder** — the cheapest of the
  four. The server already relays every command, so recording is a write, and it is what
  unlocks the other three later without touching the protocol.
- **Replay playback + scrubber UI** — load a match, play it back, scrub to any tick. Also a
  debugging tool: step to the tick where your maze failed.
- **Spectator links** — a third socket consuming the same command stream. Architecturally
  trivial; adds a connection type and permission questions.
- **Full AI-vs-AI sweep harness** — thousands of matches for balancing, on top of the thin
  bot-vs-bot runner already in v1. Attacks tuning, which is the longest pole in the project.

Decide these before starting step 10 (the server), since recording changes what the relay
writes.

---

## Open questions carried from the review

These are unresolved *questions*, not deferred work. Each is answered by measurement, not by
a decision.

1. **Economy and tuning constants** — income curve, income-per-gold by tier, bounty, sell
   refund fraction, spawn-queue interval (4 ticks is a guess), tier unlock ticks, starting
   lives (20) and starting gold (60), tower costs. The longest pole in the project and not
   covered by the build estimate.
2. **Aggro soak** — targeting is always lowest `dist`, so a long-lived tank absorbs every
   tower while fresh swarms walk behind it unharassed. Feature or degenerate? Unknown.
3. **Creep population ceiling** — bounded only by gold; nothing but damage removes a creep.
   Target 500 at 20Hz inside 25ms, unmeasured.
4. **Does a 40%-scale opponent view carry counter-picking?** Premise-level: "you see their
   maze and send what exploits it." Check the moment it renders.
5. **Background-tab throttling** — alt-tabbing stalls both players under lockstep. On the web
   this is a common path, not an edge case. The strongest argument for an authoritative
   server at v2.
6. **Is a non-decided midgame reachable at all?** Creep HP is uncapped and escalates on a
   timer; tower power caps at three levels. Lives only fall, nothing but damage removes a
   creep, income compounds. The first creep your maze cannot kill may decide the match minutes
   before it ends. This is not "pick better constants" — it may be structural. The harness
   needs a **match-decided metric** (the tick after which the loser never regains a life) as
   its first measurement. If the answer is no, the fixes are structural: a fourth tower tier,
   tower damage scaling with creep tier, or a cap on creep HP growth.

---

## Added by the engineering review

### Server + browser integration tests
**What:** Two fake sockets exercising the Durable Object relay — wire validation, version
handshake, strict-wait stall and resume, one-command-per-player-per-tick, watermark handling.
Plus Playwright for the three.js render path and the Zustand throttle.

**Why:** Explicitly excluded from the v1 test tier, which covers the sim and two extracted
client predicates. This is the layer where the realistic failure lives — a stale tab after a
mid-session redeploy — and nothing else records that it is uncovered.
**Trigger:** before or alongside any Colyseus migration, since that rewrites this layer.
**Effort:** L (human) → M (with CC). **Priority: P2.**

### SDF text atlas for lap counts
**What:** Pack digits into a signed-distance-field atlas so lap counts render as real numerals
in a single instanced draw call.

**Why:** v1 uses pips because 500 text labels is 500 draw calls. Pips stop being precise past
four or five laps — you know a creep is bad without knowing it is on lap 9.
**Trigger:** you find yourself squinting to count pips during a real match.
**Effort:** M → S. **Priority: P3.**

### `## Testing` section in CLAUDE.md
**What:** Once `package.json` exists, record the test command and framework (Vitest) in
CLAUDE.md.

**Why:** Review tooling auto-detects the framework from CLAUDE.md first. This review had to
infer it from the design doc because the repo is empty.
**Trigger:** the moment `package.json` lands, at step 1.
**Effort:** S → S. **Priority: P2.**

### Sequencing note — lane C is the least verifiable
**What:** The Workers relay (step 10) can run in a parallel worktree once the state shape and
command schema freeze at step 2. Consider running it **last and alone** instead.

**Why:** It is the only lane with deferred tests, an unfamiliar runtime, and no local feedback
loop. Parallelising it means holding two mental models at once on the workstream least able to
tell you when it is wrong.
**Trigger:** when you reach step 10 and are deciding whether to parallelise.
**Effort:** n/a — a scheduling decision. **Priority: P3.**
