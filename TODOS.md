# TODOS

Deferred work from the CEO review on 2026-09-07. Full reasoning in
`docs/designs/line-tower-wars-browser-duel.md` and
`~/.gstack/projects/PH-Gousse-tower-defense/ceo-plans/2026-09-07-line-tower-wars.md`.

Nothing here blocks v1 **except the P0 below**, which the harness found at step 7.
Each other item names the trigger that should make you pick it up.

---

## P0 — blocks the game being a game

### Defence outscales offence: matches that cannot end
**What:** Below roughly a 0.2 spend ratio, a bot-vs-bot match never resolves. Not "takes a long
time" — never. Measured, both sides at 40,000 ticks (33 minutes of game time):

| spend ratio | result | ticks | lives | sends | income reached |
|---|---|---|---|---|---|
| 0.10 | no result | 40,000 | 19 / 19 | 1,299 | 12,402 |
| 0.15 | no result | 40,000 | 19 / 19 | 1,812 | 20,628 |
| 0.20 | no result | 40,000 | 11 / 11 | 1,862 | 21,105 |
| 0.25 | draw | **853** | 0 / 0 | 14 | 70 |
| 0.30 | draw | 2,130 | 0 / 0 | 33 | 130 |

Two things are wrong here and they are the same thing. Tower upgrades outscale creeps once
income compounds, so 1,800 sends take 9 lives; and the transition from that to a 43-second
match happens between 0.20 and 0.25, which is a cliff, not a curve. A game whose length swings
from 43 seconds to unbounded across a 5% change in one player's spending habit has no tuning,
it has a coin flip.

**Why it matters beyond bots:** a human who turtles hits the same wall. Two competent players
who both build well have no way to finish, because the thing that ends a match — creeps
surviving a maze — gets strictly weaker relative to the maze as the match goes on.

**Where to start:** creep HP has to scale with elapsed time, or income has to stop compounding,
or leaks have to cost more than one life late. The flow-field and spatial-hash work is not
implicated; this is entirely in `creeps.json`, `towers.json` and the income rule.

**Trigger:** step 8, "Tune". This is that step's headline item, not a side quest.
**Effort:** M (human) → M (with CC) — the harness makes the measurement cheap, but choosing
what *should* happen is a design call.

**Do not** fix this by capping match length. A timeout hides the fact that the game cannot be
won on its own terms.

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
