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

### Matches are long, and the whole contest happens in the last minute
Bot-vs-bot mirror matches run about 30 minutes, and `decidedFraction` is 98-100% — which sounds
ideal and is not. It means neither side leaks for the first twenty-odd minutes and then one
collapses. A long stalemate with a sudden end, not a contest.

Measured cause: **income, not the ladder.** A tier-5 tank can break a maxed 45-tower maze by
minute 2.5, but at the income a bot has then it takes about eleven minutes to afford one.
Meanwhile the maze keeps upgrading. The crossover is set by how fast gold arrives.

Things that did NOT move it, each measured: cutting the life pool from 20 to 8 changed match
length by 4% (leaks all happen at the end, so fewer lives just ends the same collapse sooner);
halving the tier cadence from 60s to 30s changed it by 3%. Raising `growth.income` from 1.25 to
1.7 took it from 35 to 30 minutes and is the only lever that has bitten so far. Pushing it to
2.0 reaches 26 minutes but equals `growth.cost`, which flattens income-per-gold across tiers and
kills the buy-down-for-economy decision the whole economy rests on.

Worth separating before tuning further: the bot builds 45 towers and then pours every surplus
coin into upgrades forever, which is more defensive than a person would play. Some of the 30
minutes is the opponent, not the balance.

**Trigger:** next tuning session. **Effort:** M → M.

---

### The difficulty ladder is not robust to balance changes
Every balance edit this session reshuffled which reaction delay beats which. The presets are
picked by measurement now — a search over all ordered triples for one that is fully transitive
(`14/10/3` of the five that qualified) — but that search has to be re-run after any tuning
change, and there is no test that tells you the presets have gone stale beyond the ladder test
going red.

Margins are not ordered either, and the harness test says so out loud rather than asserting a
wish: hard finishes against easy with 8 lives and against normal with 15.

**Trigger:** the ladder test going red after a tuning change.
**Effort:** S → S to re-run the search; M → M to make difficulty robust by construction.

---

### A backgrounded tab freezes the simulation completely
Measured while verifying step 9: a Chrome tab that is not visible gets **zero** animation
frames, so `renderer.setAnimationLoop` never fires and the driver never advances. Harmless in
single player — the match simply pauses and resumes — but under lockstep it is a stall the peer
sees, and the peer cannot tell it apart from a hang.

The design already calls for showing a notice when a peer falls more than 40 ticks behind, so
the handling exists on paper. What is worth deciding at step 10 is whether a backgrounded tab
should surface something to its *own* player too, rather than silently pausing their match.

**Trigger:** step 10, when the relay makes stalls visible to someone else.
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

### Adaptive bot maze selection
**What:** Let the bot choose and adapt its maze in response to what is being sent at it,
rather than placing from fixed templates.

**Why:** Priced honestly in the spec: template mazes do not react, and the two difficulty
knobs (spend ratio, reaction delay) make the bot flood *harder*, never maze *smarter*. The
bot is likely the mode that gets played most.

**Trigger:** the bot reads flat after a few sessions. You will know quickly.
**Effort:** M → S. **Priority: P1.**

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
