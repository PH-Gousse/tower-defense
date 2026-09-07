# TODOS

Deferred work from the CEO review on 2026-09-07. Full reasoning in
`docs/designs/line-tower-wars-browser-duel.md` and
`~/.gstack/projects/PH-Gousse-tower-defense/ceo-plans/2026-09-07-line-tower-wars.md`.

Nothing here blocks v1. Each item names the trigger that should make you pick it up.

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

### Server-side integration tests
**What:** Two fake sockets exercising wire validation, the version handshake, strict-wait
stall and resume, and one-input-per-player-per-tick.

**Why:** Explicitly out of the accepted unit-test tier. It is the layer where the realistic
failure lives — a stale tab after a redeploy.
**Trigger:** before or alongside the Colyseus migration, since that rewrites this layer.
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
   refund fraction, trap multiplier (3× is a guess), tier unlock times, starting lives (20 is
   a working figure), tower costs. The longest pole in the project and not covered by the
   build estimate.
2. **Aggro soak** — targeting is always lowest `dist`, so a long-lived tank absorbs every
   tower while fresh swarms walk behind it unharassed. Feature or degenerate? Unknown.
3. **Creep population ceiling** — bounded only by gold; nothing but damage removes a creep.
   Target 500 at 20Hz inside 25ms, unmeasured.
4. **Does a 40%-scale opponent view carry counter-picking?** Premise-level: "you see their
   maze and send what exploits it." Check the moment it renders.
5. **Background-tab throttling** — alt-tabbing stalls both players under lockstep. On the web
   this is a common path, not an edge case. The strongest argument for an authoritative
   server at v2.
