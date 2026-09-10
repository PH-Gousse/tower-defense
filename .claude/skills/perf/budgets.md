# Render budgets and what breaks them

## The budgets

From `BUDGETS` in `packages/client/src/demo/benchScene.ts`. **Every one is `[proposed]`.**
They are placeholders with the right shape, not measured targets.

| Budget | Value | Note |
|---|---|---|
| fps (median) | 60 | on unspecified hardware — that is part of the problem |
| draw calls | 200 | two boards, instanced |
| bytes/frame | 1024 | effectively "the render loop should not allocate" |
| peak creeps | 500 | **stated in `harness/src/run.ts`; real matches reach 880-1099** (issue #14) |

The last row is the one to be careful with. A proposal that assumes 500 is assuming
something currently false.

## What the benchmark actually measures

`bench.html` → `benchScene.ts` warms the **real** sim with the **real** bot on both seats
until ~300 creeps are on the board, then samples 300 frames from the **real** scene. It is
not a mock: `createScene` is the same function `main.ts` calls, so the likeliest regressions
(an InstancedMesh rebuilt per frame, a material recompiled on state change) live in exactly
the code a mock would replace.

It reports: fps mean/p50/p1, draw calls, triangles, live geometries and textures, and
bytes-per-frame where available.

## The four usual causes

### 1. Per-frame allocation

```sh
grep -n "new THREE\.\|\.map(\|\.filter(\|\.slice(\|=> {" packages/client/src/scene.ts
```

Anything allocating inside the animation loop. `Vector3`, `Matrix4`, `Color`, arrays,
closures. The fix is a module-level scratch object reused each frame — which is exactly what
`packages/sim/src/state.ts` does with `cloneState`, for the same reason.

The sim already learned this lesson expensively: cloning the full creep arrays every tick
cost the *cap* rather than the *match*, 6.4MB a tick to move a dozen creeps.

### 2. InstancedMesh misuse

- `setMatrixAt` called without setting `instanceMatrix.needsUpdate = true` → nothing moves.
- `needsUpdate` set every frame when nothing changed → a full buffer upload per frame.
- The instance count changing per frame → reallocation. Size once for the maximum.
- Per-instance colour written every frame when only a few changed.

`packages/client/src/instances.ts` is where this lives. It has tests.

### 3. Frame work that belongs on a tick

The sim runs at 20Hz; the renderer at 60-144. Anything derived from sim state — maze length,
path lines, tower counts, HUD numbers — should recompute when `state.tick` moves, not every
frame.

`scene.ts` gates this on `lastSyncedTick`. New code that reads sim state must be inside that
gate, or it does 3-7× the work for no visible difference.

### 4. Material and geometry churn

A recompiled shader is a multi-millisecond spike that a mean fps hides completely. Look at
p1 fps rather than the mean — that is what the benchmark reports p1 for.

Watch for: a material created per tower rather than shared, `needsUpdate` on a material,
geometry disposed and rebuilt on a state change.

## Reading a result

- **Median below budget, p1 far below** → spikes. Cause 4, or GC from cause 1.
- **Median below budget, p1 close to it** → steady overdraw. Cause 2 or 3.
- **Median below 10** → `THROTTLED`. Not a measurement. Foreground the tab.
- **Draw calls high** → instancing is not doing its job, or something is drawn per-object.
- **bytes/frame "not measured"** → `performance.memory` unavailable. Never read as zero.
