# ADR-0015 — The look is procedural, and every effect is inferred from two ticks

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

The first renderer drew the sim literally: a flat checkerboard, a coloured cube per tower,
a sphere per creep, on a black background. It was correct and nobody would play it. The
brief was the map this game descends from — a Warcraft 3 field, with towers that have
silhouettes, creatures that walk, shots that fly and land, and a HUD that looks built.

Three ways to get there were on the table:

1. **An asset pipeline.** Model files, textures, a loader, a build step that copies them,
   and binaries in the repository. The usual answer and the most flexible.
2. **Procedural everything.** Geometry from primitives merged with vertex colours;
   textures painted on a canvas at start-up; effects as instanced quads.
3. **Sim events.** Add a per-tick event list to `step()` — shots, deaths, leaks — so the
   renderer has something to animate.

## Decision

**Procedural everything (2), and no sim events (3 is rejected).**

Every model in the game is built in `packages/client/src/render/models.ts` from three.js
primitives with the colour baked into the vertices and merged into one geometry per shape,
so each shape is one `InstancedMesh` and one draw call for both boards together. Every
texture — turf, cobbles, glow, chevron — is painted on a 2D canvas in `textures.ts` from a
seed. The palette icons are rendered from the same models at start-up, so a card can never
disagree with the thing it sells.

The sim stays exactly as it was. Shots, deaths, leaks, builds and upgrades are **inferred
in the renderer** by comparing the previous tick with the current one, once per tick: a
tower cooldown that jumped back to its full value is a shot; an id present last tick and
absent now is a death; a lap counter that moved is a leak. Those inferences feed
fixed-capacity pools (`effects.ts`) that play the moment out over wall time.

## Consequences

- **No binaries, no pipeline.** The repository stays text, the look is a diff someone can
  read, and a change to the mortar changes its icon with it. The cost is that the models are
  what primitives can make — good low-poly, not sculpture — and a texture is a few
  milliseconds of canvas drawing on load.
- **The sim is untouched.** Zero changes under `packages/sim`, so no determinism check was
  owed, no replay moved and no hash changed. The renderer reads two states and writes none —
  which is the boundary `render-reviewer` exists to keep, and inferring events rather than
  emitting them means nothing exists in the sim only to be looked at.
- **Inference is approximate and that is acceptable.** A tower's target is reconstructed
  by re-running the targeting rule over the previous tick's creeps, so a creep that spawned
  on the very tick it was shot is missed (it is standing on the entrance). If more than one
  tick runs in a frame — lockstep catch-up — only the last tick's events are seen. Both are
  cosmetic misses, never wrong rules.
- **Every pool has a fixed capacity and recycles its oldest entry when full.** A frame
  never reallocates GPU memory for an effect; under a mass send the oldest spark is
  dropped, which nobody can see.
- **The billboard trick depends on ADR-0014.** Sprites and health bars are quads rotated
  once at construction to face the camera's fixed pitch. A free camera would need per-frame
  `lookAt`, and that would be a reason to revisit this.
- **Tests cover what a screenshot cannot.** Pools free their slots on time and recycle when
  full; every model merges, stands on the ground and fits its tile; the lane kerb leaves
  gaps where creeps enter and leave. The floor texture is injectable so the board can be
  built without a canvas in node.
- **A one-frame hook for hidden tabs.** `Scene.frame(nowMs)` is what `start()` hands the
  animation loop, exposed so a harness or a hidden tab can drive it. In development the
  scene is also reachable as `window.__ltw`; never in a build.
