# Dev setup

From a clone to a running headless match, a running client, and the tooling that keeps both
honest.

**No secrets live in this repo.** Everything below authenticates through a CLI that stores
its own credentials outside the working tree. If a step ever seems to want a token in a file,
it is wrong — stop and check.

## 1. Prerequisites

| | Version | Why |
|---|---|---|
| Node | 24 | the toolchain targets it |
| pnpm | 10 | workspace protocol, `onlyBuiltDependencies` |
| bun | any recent | **only** for the cross-engine determinism check — it runs JavaScriptCore, and node cannot |
| jq | any | every hook parses its stdin with it |
| git | any | |

```sh
node --version    # v24.x
corepack enable   # gives you the pinned pnpm
curl -fsSL https://bun.sh/install | bash
```

`bun` is not optional if you intend to ship. Node and headless Chrome are both V8, so a
determinism check that uses only those tests one engine while claiming two.

## 2. Clone and install

```sh
git clone git@github.com:PH-Gousse/tower-defense.git
cd tower-defense
pnpm install
```

## 3. Prove it works

```sh
pnpm test                        # ~25s, 366 tests
pnpm typecheck && pnpm lint      # lint IS the determinism arithmetic guard
pnpm determinism-check           # ~3.5s
pnpm replay-verify               # ~1.2s, 5 replays
bun run scripts/golden-jsc.ts    # cross-engine
```

All five green means the simulation on this machine is bit-identical to the one in CI.

## 4. A headless match

```sh
pnpm headless-match --seed 3
pnpm headless-match --seed 1 --ai-a hard --ai-b easy --max-ticks 40000
pnpm headless-match --seed 0 --max-ticks 3000 --out /tmp/my-replay.json
```

`--seed` selects a **configuration**, not a random stream — nothing in the sim consumes a
seed ([ADR-0010](adr/0010-seeds-are-reserved-not-consumed.md)). Every tool says so in its
output. Nine distinct configurations exist.

## 5. The client

```sh
pnpm dev
```

- Game: <http://localhost:5173/tower-defense/>
- Camera rig: <http://localhost:5173/tower-defense/camera>
- Render benchmark: <http://localhost:5173/tower-defense/bench>

The port moves if 5173 is taken — read what vite prints. The `/tower-defense/` prefix is the
GitHub Pages base path (`VITE_BASE` to change it).

Offline play against the bot needs no server at all.

## 6. The relay, locally

```sh
pnpm --filter @ltw/server dev              # wrangler dev
pnpm --filter @ltw/harness live            # two real lockstep clients through it
```

> `live-duel.mts` is the only thing exercising the Durable Object adapter, and it is neither
> in CI nor typechecked ([#16](https://github.com/PH-Gousse/tower-defense/issues/16)). Treat
> a failure as real until proven otherwise.

---

## Connections

### GitHub — connected, via the `gh` CLI

Issues and pull requests go through `gh`, not through an MCP server. The CLI is already
authenticated for this project (account `PH-Gousse`, scopes `repo`, `workflow`, `read:org`,
`gist`) and stores its token in the OS keyring.

On a new machine:

```sh
brew install gh        # or your platform's package manager
gh auth login          # interactive; needs `repo` and `workflow`
gh auth status
```

**Why no GitHub MCP server:** `gh` is already installed, already authenticated, and every
skill that touches GitHub uses a narrow `Bash(gh issue *)` / `Bash(gh pr *)` allowance. An
MCP server would add a second credential path and a second thing to keep running for no
capability the CLI lacks. Revisit if a skill needs something `gh` cannot express.

**Labels** (created; `gh label list` to verify):

| Label | For |
|---|---|
| `slice` | a vertical slice, sim → server → client |
| `rule` | a change to a game rule — goes through `/rule-change` |
| `balance` | tuning constants and `balance-batch` findings |
| `netcode` | relay, protocol, lockstep, desync |
| `render` | client rendering and performance |
| `determinism` | determinism, replay and hash integrity |
| `bug` | (GitHub default) |

**The backlog is GitHub issues.** There is no `docs/backlog.md`. `TODOS.md` is the historical
backlog and its still-open entries have been migrated to issues
([#18-#27](https://github.com/PH-Gousse/tower-defense/issues)); it is kept for the reasoning
it records and is not authoritative.

### Browser automation — NOT installed, deliberately

`bench-scene` needs a browser runner and does not have one. `pnpm bench-scene` is a stub that
exits non-zero rather than pretending to pass.

Nothing was installed without asking. A runner is a ~200MB download, a CI image change and a
new flake surface — a decision, not a chore. Tracked as
[#15](https://github.com/PH-Gousse/tower-defense/issues/15) and
[#24](https://github.com/PH-Gousse/tower-defense/issues/24).

To adopt one:

```sh
pnpm add -Dw @playwright/test
pnpm exec playwright install chromium
```

Then replace the body of `packages/harness/tools/bench-scene.ts`: launch chromium, navigate
to the bench URL, poll `window.__BENCH__` until it is not `{running: true}`, and emit it.

**Two flags are mandatory, and the benchmark is meaningless without them:**

```
--disable-background-timer-throttling --disable-renderer-backgrounding
    Chrome throttles a background tab's requestAnimationFrame to roughly zero.
    Without these the run measures a throttled renderer. The page detects this
    (median fps under 10 is reported as THROTTLED and forces ok:false) but a
    throttled run is a wasted run.

--enable-precise-memory-info
    Without it, performance.memory is unavailable and per-frame allocation is
    reported as "not measured" — honest, but not a measurement.
```

Until then, run it by hand: `pnpm dev`, open `/tower-defense/bench`, read the overlay or the
console line beginning `BENCH_JSON`. It warms the real sim with the real bot on both seats to
~300 creeps on two full mazes, then samples 300 frames.

### Deploying

Client deploys itself: a push to `main` runs `.github/workflows/deploy.yml` → GitHub Pages.

Relay is manual:

```sh
npx wrangler login                      # stores its own credentials, not in the repo
pnpm --filter @ltw/server deploy
```

Build the client with `VITE_RELAY=wss://<your-worker>` to point at it.

> **A relay deploy ends every live match.** There is no reconnect, and the version handshake
> refuses mismatched builds ([#18](https://github.com/PH-Gousse/tower-defense/issues/18),
> [#20](https://github.com/PH-Gousse/tower-defense/issues/20)). Deploy when nobody is
> playing. `/ship` asks before this step for exactly that reason.

---

## The tooling

See [`../CLAUDE.md`](../CLAUDE.md) for the full command table, and Phase-by-phase detail in
the skill and hook files themselves.

### Skills — `.claude/skills/<name>/SKILL.md`

| Skill | Type it when |
|---|---|
| `/decide` | a choice has more than one reasonable option. Writes the ADR on acceptance. |
| `/rule-change` | **any** change to a game rule or balance constant. The only sanctioned path. |
| `/determinism-check` | after touching `packages/sim`. Auto-invokes. |
| `/replay-verify` | after changing anything a replay reads. Auto-invokes. |
| `/balance` | you want tuning evidence. Proposes; never applies. |
| `/netcode-review` | reviewing a server or transport diff. Auto-invokes on those paths. |
| `/perf` | render cost. Currently blocked on the browser runner. |
| `/ship` | releasing. Stops at the first failed gate; asks before deploying. |
| `/slice` | building an issue end to end. |

> `/ship` also exists as a gstack skill in `~/.claude/skills/`. The project one wins.

### Subagents — `.claude/agents/<name>.md`

`sim-reviewer` · `render-reviewer` · `netcode-reviewer` (read-only reviewers) ·
`balance-analyst` (owns large outputs) · `test-author` (tests only) · `docs-keeper`
(docs only).

### Hooks — `.claude/settings.json`, scripts in `.claude/hooks/`

| Hook | Fires | Does |
|---|---|---|
| constants guard | before any edit | blocks `packages/sim/data/*.json` and the starting-value constants unless a `/rule-change` is open |
| sim pre-edit guard | before any edit | scans the **proposed** content for banned APIs; blocks with the offending line |
| post-edit checks | after any edit | `eslint --fix`, package typecheck, that file's test (~3.5s) |
| stop guard | before the turn ends | if `packages/sim` changed: full sim suite + `determinism-check`, and blocks "done" on failure |
| invariants injector | session start, pre-compaction | injects `docs/invariants.md` verbatim |

**The constants guard, and the one way to get it wrong.** It reads a marker file,
`.claude/.rule-change-active` — a file rather than an environment variable because a hook
runs in its own process and cannot see a variable the model set.

```sh
pnpm rule-change:begin     # disarm — only from /rule-change or /balance acceptance
pnpm rule-change:end       # re-arm — ALWAYS, even if you abandon the change
pnpm rule-change:status
```

A marker left behind disarms the guard for every later session. That is the single failure
mode that makes the guard worse than not having one, which is why the injector prints the
guard's state at every session start and why the guard itself announces when it is disarmed.

The marker and the hooks' session state are gitignored and never leave the machine.

**Never weaken a hook, a lint rule or a check to make something pass.** If a guard is wrong,
that is a `/rule-change` with a written reason.
