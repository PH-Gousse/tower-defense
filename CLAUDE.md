# tower-defense

A browser remake of the Warcraft 3 **Line Tower Wars** map: 1v1 online or against an AI
opponent, where you build a free-form tower maze in your own lane and spend gold sending
creeps into your opponent's — and a creep that reaches the exit costs a life and then loops
back to run the maze again until towers kill it. TypeScript throughout: a pure deterministic
simulation package, a three.js client, a Cloudflare Workers relay, and a headless harness.

## Packages

| Path | Name | What it is |
|---|---|---|
| `packages/sim` | `@ltw/sim` | The rules. Pure, deterministic, zero runtime dependencies, imports nothing. |
| `packages/client` | `@ltw/client` | Vite + three.js. Renders sim state; never mutates it. |
| `packages/server` | `@ltw/server` | Cloudflare Workers + Durable Objects relay. Orders commands, records the log. |
| `packages/harness` | `@ltw/harness` | Headless bot-vs-bot runner and the balance tooling. |

## Commands

| Purpose | Command |
|---|---|
| Test | `pnpm test` (~25 s; `@ltw/harness` is most of it) |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` — this **is** the arithmetic/ordering determinism guard |
| Build | `pnpm build` |
| Dev server | `pnpm dev` → http://localhost:5173 |
| Relay, locally | `pnpm --filter @ltw/server dev` (wrangler) |
| Headless match | `pnpm headless-match --seed N [--ai-a easy\|normal\|hard] [--ai-b …] [--max-ticks N] [--out replay.json]` |
| Determinism check | `pnpm determinism-check [--seeds 20] [--max-ticks 5000]` (~3.5 s) |
| Replay verify | `pnpm replay-verify` (~1.2 s, covers `fixtures/replays/` + the golden fixtures) |
| Balance batch | `pnpm balance-batch [--matches 18] [--max-ticks 40000]` → `reports/balance/<date>.md` |
| Benchmark | `pnpm bench-scene` — **stub, exits non-zero.** No browser runner installed; see issue #15 |
| Banned-API scan | `pnpm banned-api-scan [files…]` (< 0.3 s; the pre-edit hook uses it) |
| State hash | `pnpm state-hash --replay <file.json> [--every N]` |
| Cross-engine golden | `bun run scripts/golden-jsc.ts` (JavaScriptCore, not V8) |

Every tool prints a human summary and a single line of JSON as its **last** line, and exits
non-zero on failure. Sources in `packages/harness/tools/`.

Older harness entry points: `pnpm --filter @ltw/harness` + `start` (one match) ·
`gauntlet` (creep vs maze table) · `lap` (HP needed per lap) · `flood` (the bot's leak model
against a streamed send) · `roster` (creep economics) ·
`opening` (build-phase sweep) · `replay <dump.json>`.

Requires Node 24 and pnpm 10. `bun` is needed only for the cross-engine check.

## Where things are written down

| | |
|---|---|
| Game rules | [`docs/gdd.md`](docs/gdd.md) — **authoritative** |
| Engineering invariants | [`docs/invariants.md`](docs/invariants.md) |
| Decisions | [`docs/adr/`](docs/adr/) |
| Balance constants | `packages/sim/data/towers.json`, `packages/sim/data/creeps.json`, and `STARTING_GOLD` / `STARTING_INCOME` in `packages/sim/src/data.ts`, `STARTING_LIVES` in `packages/sim/src/state.ts` |
| Work in flight | GitHub issues (`gh issue list`) |
| Machine setup | [`docs/dev-setup.md`](docs/dev-setup.md) |

[`docs/designs/line-tower-wars-browser-duel.md`](docs/designs/line-tower-wars-browser-duel.md)
is **historical**. It records how the project was reasoned into being and is worth reading
for the why, but where it and the GDD disagree the GDD wins. Do not update it.
`TODOS.md` is the historical backlog; its still-open entries are now issues #18-#27. It is
kept for the reasoning it records and is not authoritative.

## Conventions

- **TypeScript strict**, with `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `verbatimModuleSyntax` and `isolatedModules`. Index access yields `T | undefined`; the
  codebase uses `as T` at hot-loop sites deliberately, not casually.
- **No default exports.** The single exception is `packages/server/src/index.ts`, where the
  Workers runtime requires one.
- **Vitest** everywhere, `test/` beside `src/`. A test names the rule it pins, not the
  function it calls.
- **No `const enum`** — esbuild cannot inline it, so it breaks under Vite and Vitest, and
  `isolatedModules` makes ambient references an error. Plain `enum`.
- **Commit format:** `type: what changed, in prose, lowercase, no full stop`. Types in use:
  `feat`, `fix`, `docs`, `chore`, `tune`. The subject says what a player or a reader would
  notice — *"one click sends one creep, and nothing paces them"*, not *"refactor spawn
  queue"*. Never add an AI co-author trailer or a generated-with footer.
- **Naming a `Refusal`:** name the condition **from the player's side**, not the check that
  failed. `NotEnoughGold`, not `GoldCheckFailed`. `WouldSealLane`, not `InvalidPlacement`.
  Every member needs an on-screen message and must be checked **before any gold moves**.
  Adding one means adding it to `packages/server/src/protocol.ts` too — see issue #9.
- Comments explain **why**, and especially why the obvious alternative was rejected. This
  codebase's comments carry measurements and dead ends; keep that.

## Working rules

- **`/decide`** for any choice with more than one reasonable option. It writes the ADR.
- **`/rule-change`** for any change to a game rule. It is the only sanctioned path, and it
  moves `docs/gdd.md`, the constants and the tests together.
- **Never edit balance constants** outside `/rule-change` or `/balance` acceptance. A hook
  enforces this.
- **`/determinism-check` before claiming sim work is done.** Also `/replay-verify` if you
  touched anything a replay reads.
- Never weaken a check, a lint rule or a hook to make something pass. If a guard is wrong,
  change it deliberately through `/rule-change` and say why.
- A red golden fixture after a balance change is expected; after a logic change it is a bug.
  Tell the two apart before regenerating anything.

## Skill routing

Project skills: `/decide` · `/rule-change` · `/determinism-check` · `/replay-verify` ·
`/balance` · `/netcode-review` · `/perf` · `/ship` · `/slice`.

General gstack skills, when the request matches: product ideas → `/office-hours`; strategy →
`/plan-ceo-review`; architecture → `/plan-eng-review`; design → `/design-consultation` or
`/plan-design-review`; full review pipeline → `/autoplan`; bugs → `/investigate`; QA →
`/qa` or `/qa-only`; code review → `/review`; visual polish → `/design-review`; save or
resume progress → `/context-save`, `/context-restore`; author a spec → `/spec`.
