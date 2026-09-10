# tower-defense

A browser remake of the Warcraft 3 **Line Tower Wars** map: 1v1, or 1 vs an AI bot.

You build a free-form tower maze in your own lane and spend gold sending creeps into your
opponent's. A creep that reaches the exit costs the defender a life and then **loops back to
run the maze again**, until towers kill it. Leaks are a drain, not a penalty.

- **Game rules:** [`docs/gdd.md`](docs/gdd.md) — authoritative
- **Invariants:** [`docs/invariants.md`](docs/invariants.md) · **Decisions:** [`docs/adr/`](docs/adr/)
- **Design spec:** [`docs/designs/line-tower-wars-browser-duel.md`](docs/designs/line-tower-wars-browser-duel.md) — historical, kept for the reasoning
- **Backlog:** GitHub issues · [`docs/dev-setup.md`](docs/dev-setup.md) to get a machine running
- **Historical backlog:** [`TODOS.md`](TODOS.md) — open items migrated to issues #18-#27
- **Reference layout:** [`docs/designs/duel-screen-wireframe.png`](docs/designs/duel-screen-wireframe.png)

## Status

**Step 11 of 11: local prediction.** All eleven build steps have landed. What follows is
tuning, not construction.

A pure simulation package with a flow field, driven at a fixed 20Hz. Creeps walk the maze;
towers reroute them; a placement that would seal the lane is refused **with the reason in
words**, and hovering previews both the route you would create and how many tiles it adds.

Three tower archetypes at three levels each, with a spatial hash so targeting stays cheap as
the creep population grows. Towers shoot, creeps die, and you can upgrade or sell any tower
by clicking it.

A creep that reaches the exit costs you a life and then **loops back to run the maze again**,
keeping its damage and its lap count. Nothing but tower damage removes it. Lap count shows as
pips on the creep, the route that produced a leak flashes red, and at zero lives the match
ends. One creep your maze cannot kill is enough to lose.

**Two lanes**, vertical, **8 × 24 tiles each** — the opponent's exactly as large as yours,
and both drawn at full size side by side, because you cannot counter-pick a maze you cannot
read. Creeps enter top-left and leave bottom-right, so even a bare lane is a diagonal walk;
the entrance and exit rows are reserved and never take a tower. The board is a real 3D scene
seen down a fixed Warcraft-style camera: fixed yaw, zoom and pan only.

You defend your lane and send creeps into your opponent's. The first twenty seconds are a
build phase: nobody can send yet, so you lay your opening maze without a wave already walking
it. Income arrives in a lump every 15 seconds from the moment sending opens, and the only way
it grows is by sending, so every lump is a fork: towers to survive what is coming, or creeps
to pressure them and compound. Turtling loses the money war; over-sending leaves you exposed.
Killing a creep in your own lane pays a bounty, and stronger creep tiers unlock on a timer so
threat and economy escalate together. One click sends one creep — nothing paces them, and
gold is the only thing rationing a send.

**Both opponents work.** An AI bot at three difficulties plays a full match client-side with
no network at all, and a Cloudflare Workers relay runs 1v1 online over a room code, with
local prediction so your own inputs land immediately. Difficulty is how much of its economy
the bot commits to attacking — measured transitive by a round robin, not asserted.

Determinism is verified, not asserted: the golden fixture replays a committed command log to
a committed hash on **two different engines** (V8 via node, JavaScriptCore via bun). They
agree. Every tick's state hash is recorded locally into a ring, and a desync dump replays
headlessly to find which side was wrong — but the peer-to-peer hash **exchange** that would
detect a live divergence is not wired up yet (issue #30).

**Not built yet:** reconnect (a dropped connection ends the match), spectating, replay URLs,
and a balance pass on numbers that are still placeholders. See
[`docs/gdd.md`](docs/gdd.md) §11 and the open issues.

## Develop

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build
pnpm typecheck  # types only
pnpm test       # sim + client test suites (vitest)
pnpm lint       # determinism guards
```

Requires Node 24 and pnpm 10.

## Layout

```
packages/client    Vite + three.js, DOM overlay
packages/sim       pure TS simulation, plus the AI opponent
packages/server    Cloudflare Workers relay
packages/harness   headless bot-vs-bot runner and balance tooling
```

`packages/sim` has zero three.js and zero DOM dependency, and its arithmetic is restricted to
`+ - * / sqrt` so replays and matches stay bit-identical across engines. That single property
is what makes replays, spectating, the AI opponent and headless balance runs all fall out of
one decision. See [`docs/adr/0001`](docs/adr/0001-shared-deterministic-typescript-sim.md) for why.
