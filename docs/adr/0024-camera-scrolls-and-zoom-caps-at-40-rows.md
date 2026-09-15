# ADR-0024 — The camera scrolls the lane, zoom caps at 40 rows, and a minimap shows the rest

- **Date:** 2026-09-13
- **Status:** Accepted — implemented 2026-09-13 (issues #44, #45); the input bindings remain `[proposed]`. The default moved from 20 rows to 30 on 2026-09-15, confirmed by play on the 100-row lane (ADR-0027): 20 opened too close.

## Context

ADR-0014's camera fits the whole 24-row board in frame at every viewport and clamps its
distance so it always can. ADR-0019's lane is 213 rows: no framing that shows it all is
readable, so the camera becomes a scrolling one and the question is how far out it may go.

Numbers, from the rig's own factors at the shipped pose (fov 18, pitch 70): the visible
ground depth is 0.338 × distance and the visible width at the far edge is about
0.336 × aspect × distance.

| Rows in frame | Distance | Width on 16:9 | Width on 390×844 |
|---|---|---|---|
| 20 | ≈ 59 | ≈ 35 tiles | ≈ 9 tiles |
| 40 | ≈ 118 | ≈ 71 tiles | ≈ 18 tiles |
| 60 | ≈ 177 | ≈ 106 tiles | ≈ 28 tiles |

At 1080p a row is 27 px at 40 rows and 18 px at 60. A 2-tile tower is therefore 54 px or
36 px; a 1-tile creep 27 px or 18 px.

## Decision

- **Maximum zoom-out shows 40 rows.** About five screens per lane at full zoom-out.
- **Default framing shows 20 rows `[proposed]`**, about ten screens per lane. *(Moved to 30
  on 2026-09-15; see Status.)*
- **Portrait is width-bound.** On a 390×844 viewport 20 rows shows 9 tiles, less than a
  lane, so the default there fits the lane's 16 tiles instead (about 35 rows). 40 rows shows
  18 tiles, one lane with 2 to spare, so the cap holds on phones.
- **A minimap** overlay shows both lanes full-length as a tall thumbnail: tower footprints,
  creep dots by owner, the zones, and the viewport rectangle. 2 px per tile on desktop
  (426 × 72 px for both lanes), 1 px on phones, refreshed from the snapshot at about 4 Hz
  and never per frame. Click or drag on it jumps the camera.
- Fixed yaw, pitch and fov, and the pose-is-derived rule, are unchanged from ADR-0014.

Rejected:

- **60 rows.** Three and a half screens per lane, but a creep is 18 px and a tower 36 px:
  creeps become colour rather than shape, and the maze reads as texture.
- **Whole lane in frame.** 5 px per tile. That is the minimap's job.

## Consequences

- `DEFAULT_MAX_DISTANCE` (115, tuned to fitting 24 rows on a 1024×500 viewport) is
  re-derived as "the distance at which 40 rows are visible", about 120, and the guard
  test's viewport table is rewritten around rows-in-frame rather than fits-the-board.
- Panning along the lane becomes the primary input, and needs edge scroll, keys, drag,
  touch drag and a wheel-with-modifier mode. Clamp so the view never leaves the two lanes
  plus a margin.
- Because most of the lane is off-screen most of the time, frustum culling must actually
  engage and the game needs off-screen alerts (a leak, a firing tower) and jump hotkeys.
- Reasoned from the rig's maths, not rendered. Revisit trigger: the 40-row render looking
  mushier than the pixel arithmetic suggests, in which case cap at 32.
