# ADR-0029 — There is no minimap

- **Date:** 2026-09-15
- **Status:** Accepted — implemented 2026-09-15; supersedes the minimap half of ADR-0024

## Context

ADR-0024 made the camera scroll a lane it could not show whole, and added a minimap of both
lanes full-length beside the canvas: zones, footprints, creep dots, the viewport rectangle,
click to jump. It shipped with the jump keys (`Home`, `End`, `Tab`, `Space`) and the
off-screen alert arrows, and the three were treated as one navigation kit.

Two days of play on it, and the user asked for the minimap to go. The lane is also being cut
to 100 buildable rows (ADR-0027), which halves what the minimap had to summarise: at 20 rows
in frame the lane is five screens, not ten.

## Decision

**Remove the minimap.** The canvas, the module, its test and the scene's repaint cadence are
gone. Navigation is panning (drag, arrows, edge scroll, wheel), the four jump keys, and the
off-screen alert arrows, which stay. `visibleBounds` on the camera rig stays too — the
alerts need the view box the minimap used to draw.

## Consequences

- Reading the opponent's maze is `Tab` plus panning. Nothing shows both lanes at once.
- The 390×844 phone check still owed from Phase 7 has one fewer element to fit.
- GDD §1 and §9 updated. ADR-0024 keeps its text; its README row notes the split.
