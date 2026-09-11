# Animation contract

What every rigged asset promises the client, and what the client promises back. The gate
checks the checkable half (names, loop flags, frame rate, durations, no root motion); the
critique checks loop quality by eye.

## 1. Clip names

Exact, capitalised, one word. A clip with any other name fails the gate. A required clip
that is missing fails the gate.

### Creeps — Idle, Walk, Death, Spawn (all required)

| Clip | Loop | Length `[proposed]` | Ends with | The game then |
|---|---|---|---|---|
| `Idle` | loop | 1.0 to 2.0 s | seamless | keeps looping; the default clip |
| `Walk` | loop | one full stride cycle: two steps | seamless | keeps looping; `timeScale` set from speed (§4) |
| `Death` | one-shot | 0.5 to 1.2 s | last frame held | holds the last frame as the corpse, fades and removes after `CORPSE_MS` (1 400 ms) |
| `Spawn` | one-shot | 0.4 to 0.8 s | the first frame of `Walk` | crossfades to `Walk` |

### Towers — Build, Idle, Attack, Upgrade, Sell (all required)

| Clip | Loop | Length `[proposed]` | Ends with | The game then |
|---|---|---|---|---|
| `Build` | one-shot | 0.5 to 1.0 s | the first frame of `Idle` | crossfades to `Idle` |
| `Idle` | loop | 2.0 to 4.0 s, subtle | seamless | keeps looping; the default clip |
| `Attack` | one-shot | ≤ the tower's cooldown, and ≤ 0.6 s | the first frame of `Idle` | returns to `Idle`; the projectile leaves at the `fire` marker (§3) |
| `Upgrade` | one-shot | 0.4 to 0.8 s | the first frame of `Idle` | plays on the **new** level's model, then `Idle` |
| `Sell` | one-shot | 0.4 to 0.8 s | the model below ground or at zero scale | removes the model |

### Projectiles, effects, tiles, props

No clips. Motion is the pool's job (`render/effects.ts`).

## 2. Frame rate, sampling, timing

- **24 fps** `[proposed]`. Blender's default, and enough for anything that plays under
  a 70° camera at 50 px tall. The gate resamples every clip to 24 fps on admission, so an
  imported asset at 30 or 60 fps is fine; the *file in `assets/build/`* is always 24.
- Clip length is stored in seconds in the manifest, from the resampled clip.
- **Loops are seamless.** The last keyframe of a loop equals the first (the generator
  writes it that way; the gate checks the pose delta at the seam is under 1 mm and 0.5°
  per bone).
- **No root motion.** `Walk` cycles in place; the sim owns position. The gate rejects a
  clip whose root bone translates more than 0.02 units across the loop.
- **One armature, one root bone**, named `root`, at the origin, +Z forward. Bone names
  follow the rig template (`generators.md`); a retargeted import must end up with the
  template's names.

## 3. Markers

One-shot clips may carry markers, stored as glTF `extras` on the animation:

```json
{ "markers": { "fire": 0.35 } }
```

Values are normalised time (0 to 1). Recognised markers:

| Marker | Clip | Meaning |
|---|---|---|
| `fire` | `Attack` | the projectile leaves the muzzle now; the shot sound plays now. Default 0.0 if absent. |
| `land` | `Spawn` | the creep touches the ground; the spawn sound plays now. Default 0.0. |
| `impact` | `Death` | the body hits the ground; the dust puff plays now. Default 0.6. |

The muzzle position is the `muzzle` attachment point (an empty named `muzzle` in the
exported hierarchy), replacing `muzzleHeight()` in `models.ts`.

## 4. What the client does

`AnimatedModel` (Phase 6) owns one `AnimationMixer` per instance and one `AnimationAction`
per contract clip.

- `play(state)` crossfades to the clip for the state over **120 ms** `[proposed]`
  (`fadeIn`/`fadeOut`, `crossFadeTo`). A one-shot that is already playing is not
  restarted by the same state again.
- `Walk.timeScale = speedTilesPerSecond / strideTilesPerCycle`, where
  `strideTilesPerCycle` is declared in the spec (`animations.Walk.stride`, in tiles the
  creature would cover per cycle if it moved). A slowed creep scales down with its speed,
  so feet stop sliding. The gait table in `scene.ts` retires.
- One-shots set `clampWhenFinished = true` and `loop = LoopOnce`; the client subscribes
  to `finished` and applies the "the game then" column above.
- Missing clip in dev: throws with the asset id and the clip name. In a build: logs once
  and falls back to `Idle`.
- The mixer advances with the render clock (wall time), not the sim tick, so animation
  never depends on lockstep catch-up.

## 5. What the sim does

Nothing. No animation state, no event, no timing lives in `packages/sim`. Every trigger
here is inferred by the scene from two ticks, as ADR-0015 already does for effects.
