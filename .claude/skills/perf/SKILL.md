---
name: perf
description: Run the render benchmark, compare against budgets, identify the top three costs with file and line, and propose fixes. Currently blocked on there being no browser runner installed.
disable-model-invocation: true
context: fork
agent: render-reviewer
background: false
allowed-tools: Read Grep Glob Bash(pnpm bench-scene*) Bash(pnpm dev*) Bash(pnpm build*) Bash(git diff *)
---

# /perf

```sh
pnpm bench-scene
```

## Say the blocker first

`bench-scene` is a **stub and exits non-zero.** No browser automation is installed, and
installing it was deliberately not done unprompted (issue #15). Your first line must say
this, before any numbers, so nobody reads a static review as a measurement.

**The scene itself is real and works.** Verified by hand: 307 creeps, 90 towers, two full
mazes. To get numbers today, a human runs:

```sh
pnpm dev
# open http://localhost:5173/tower-defense/bench
# read the overlay, or the console line beginning BENCH_JSON
```

Two things that will otherwise produce garbage, both found by hitting them:

- **The tab must be foregrounded**, or Chrome throttles rAF to ~0. The page detects this and
  reports `THROTTLED`; a throttled run is never a pass. `--disable-background-timer-throttling
  --disable-renderer-backgrounding` if driving it.
- **`--enable-precise-memory-info`**, or per-frame allocation reports "not measured" — which
  is honest, but it is not a measurement.

## Without numbers, review statically

You can still do useful work. Read [`budgets.md`](budgets.md) for what the budgets are and
what usually breaks them, then look for the four costs that actually matter in this
renderer:

1. **Per-frame allocation** in the render loop — anything constructing a `Vector3`,
   `Matrix4`, array or closure inside `frame()`.
2. **InstancedMesh misuse** — rebuilding buffers every frame instead of on change,
   `setMatrixAt` without `instanceMatrix.needsUpdate`, or a count that grows without the
   buffer being resized once.
3. **Work on every frame that belongs on every tick.** The sim runs at 20Hz and the renderer
   at 60+. Anything derived from sim state should be recomputed when `state.tick` moves, not
   per frame — `scene.ts` already gates on `lastSyncedTick`, so check new code does too.
4. **Material or geometry churn** — a material recompiled on a state change is a frame spike
   that no fps average shows.

## Rules

- **Never report a throttled or stubbed run as a pass.** `ok: false` means `ok: false`.
- Budgets in `benchScene.ts` are `[proposed]` placeholders — nobody has profiled this on the
  hardware it has to run on. A breach is "look at it", not "this is broken". Say which.
- Read-only. Propose fixes with file and line; do not apply them.
- Peak creep population reaches 880-1099 in real matches against a stated budget of 500
  (issue #14). If a proposal assumes 500, say that the assumption is currently false.

## Finish by printing

```
BLOCKED:  <the stub, and what a human must run to get real numbers>
MEASURED: <numbers if a human supplied them, or "none — static review only">
BUDGETS:  <breaches, and that the budgets are [proposed]>
TOP 3:    <file:line — the cost — why it costs — proposed fix>
NOT DONE: <changed nothing; what you could not assess without a runner>
```
