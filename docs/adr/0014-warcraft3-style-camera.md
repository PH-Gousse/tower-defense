# ADR-0014 — Warcraft 3-style camera: real 3D, fixed yaw, zoom and pan only

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

A tile-based tower game can be drawn in 2D, in 2.5D, or in a real 3D scene. The design's
premise is that this should *feel* like the map it descends from, and that feel comes
substantially from the camera: a high-angle perspective view over a real scene.

Free orbit was never on the table — reading an opponent's maze at a glance requires that
every maze be seen from the same angle.

## Decision

A real 3D three.js scene with a **fixed high-angle perspective camera**. **Fixed yaw. Zoom
and pan only.**

Camera pose is a single source of truth — pitch, yaw, distance — and the camera's position
is *derived* from those every frame. There is exactly one place a pose can be wrong, and
pitch/yaw/roll cannot drift whatever order events arrive in.

Shipped pose: fov 18, pitch 70. Warcraft 3's own pitch is 56; raising it alongside a
narrowed fov is what keeps the near/far scale ratio close to 1 (1.095 here, against 1.565 at
the rig's first pose) so the far end of a 24-tile lane is not visibly smaller than the near
end.

## Consequences

- **Perspective, not orthographic — rejected rather than deferred.** The picking path
  divides by `tan(fov/2)`, so an orthographic camera is a rewrite of picking, not a flag.
  Orthographic would give a scale ratio of exactly 1.000; the narrow-fov perspective gets to
  1.095, which was judged close enough to not be worth the rewrite.
- Both lanes are drawn at full size side by side, because you cannot counter-pick a maze you
  cannot read.
- The camera derives everything from sim state and mutates none of it. A renderer that wrote
  back into sim state would be a determinism hole — this is what `render-reviewer` checks.
- Zoom is bounded by the pitch at which the horizon enters frame (`kf` runs to infinity as
  pitch approaches half the fov), so the limit is computed rather than hard-coded, and a fov
  change that outgrows it clamps instead of throwing.
