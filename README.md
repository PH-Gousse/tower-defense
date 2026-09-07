# tower-defense

A browser remake of the Warcraft 3 **Line Tower Wars** map: 1v1, or 1 vs an AI bot.

You build a free-form tower maze in your own lane and spend gold sending creeps into your
opponent's. A creep that reaches the exit costs the defender a life and then **loops back to
run the maze again**, until towers kill it. Leaks are a drain, not a penalty.

- **Design spec:** [`docs/designs/line-tower-wars-browser-duel.md`](docs/designs/line-tower-wars-browser-duel.md)
- **Backlog:** [`TODOS.md`](TODOS.md)
- **Reference layout:** [`docs/designs/duel-screen-wireframe.png`](docs/designs/duel-screen-wireframe.png)

## Status

**Step 5 of 11: the loop.** A pure simulation package with a flow field, driven at a fixed
20Hz by the client. Creeps walk the maze; towers reroute them; a placement that would seal
the lane is refused.

Three tower archetypes at three levels each, with a spatial hash so targeting stays cheap as
the creep population grows. Towers shoot, creeps die, and you can upgrade or sell any tower
by clicking it. Placement is still refused **with the reason in words** when it would seal
the lane, and hovering previews both the route you would create and how many tiles it adds.

A creep that reaches the exit costs you a life and then **loops back to run the maze again**,
keeping its damage and its lap count. Nothing but tower damage removes it. Lap count shows as
pips on the creep, the route that produced a leak flashes red, and at zero lives the match
ends. One creep your maze cannot kill is enough to lose.

Gold is a fixed budget for now — income, kill bounty and creep tiers arrive at step 6.

Determinism is verified, not asserted: the golden fixture replays a committed command log to
a committed hash on **two different engines** (V8 via node, JavaScriptCore via bun). They
agree.

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
packages/client    Vite + three.js + React overlay
packages/sim       pure TS simulation          (step 2)
packages/server    Cloudflare Workers relay    (step 10)
packages/harness   headless bot-vs-bot runner  (step 7)
```

`packages/sim` has zero three.js and zero DOM dependency, and its arithmetic is restricted to
`+ - * / sqrt` so replays and matches stay bit-identical across engines. That single property
is what makes replays, spectating, the AI opponent and headless balance runs all fall out of
one decision. See the design spec for why.
