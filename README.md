# tower-defense

A browser remake of the Warcraft 3 **Line Tower Wars** map: 1v1, or 1 vs an AI bot.

You build a free-form tower maze in your own lane and spend gold sending creeps into your
opponent's. A creep that reaches the exit costs the defender a life and then **loops back to
run the maze again**, until towers kill it. Leaks are a drain, not a penalty.

- **Design spec:** [`docs/designs/line-tower-wars-browser-duel.md`](docs/designs/line-tower-wars-browser-duel.md)
- **Backlog:** [`TODOS.md`](TODOS.md)
- **Reference layout:** [`docs/designs/duel-screen-wireframe.png`](docs/designs/duel-screen-wireframe.png)

## Status

**Step 3 of 11: mazing.** A pure simulation package with a flow field, driven at a fixed
20Hz by the client. Creeps walk the maze; towers reroute them; a placement that would seal
the lane is refused.

Build towers and watch creeps reroute. The route they take is drawn on the field, hovering a
tile previews the route you would create and how many tiles it adds, and a placement that
would seal the lane is refused **with the reason in words** rather than silently ignored.

Determinism is verified, not asserted: the golden fixture replays a committed command log to
a committed hash on **two different engines** (V8 via node, JavaScriptCore via bun). They
agree.

## Develop

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # typecheck + production build
pnpm typecheck  # types only
pnpm test       # sim test suite (vitest)
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
