"""
Unrigged plans: projectiles (`bolt`, `shell`, `orb`) and tiles (`tile_flat`,
`tile_marker`). A projectile points along +Z (forward) and is centred on
its origin rather than grounded, because the pool orients it along its
flight; a tile is a 1 × 1 slab whose origin is its centre on the ground.
"""

from __future__ import annotations

import math

from ..layout import Layout, Prim
from ..params import P
from ..registry import body_plan


def _centre(lay: Layout) -> None:
    lo, hi = lay.bounds()
    moved = lay.placed((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -(lo[2] + hi[2]) / 2))
    lay.prims, lay.attachments, lay.joints = moved.prims, moved.attachments, moved.joints
    lay.height = float(hi[1] - lo[1])
    lay.footprint = float(max(hi[0] - lo[0], hi[2] - lo[2]))


@body_plan("bolt", "projectile", {
    "length": P(0.36, 0.1, 0.8),
    "radius": P(0.012, 0.005, 0.05),
}, attachments=[], slots=["shaft", "head", "fletching"], doc="""
bolt -- an arrow: shaft, iron head, pale fletching. Points along +Z.
""")
def bolt(p: dict, rng) -> Layout:
    lay = Layout()
    L, r = p["length"], p["radius"]
    lay.add(Prim("cyl", (r, r, L), (0, 0, 0), (math.pi / 2, 0, 0), slot="shaft", seg=5, name="shaft"))
    lay.add(Prim("cone", (r * 2.5, L * 0.22), (0, 0, L * 0.5), (math.pi / 2, 0, 0), slot="head", seg=5, name="head"))
    lay.add(Prim("box", (r * 6, r * 0.8, L * 0.2), (0, 0, -L * 0.4), slot="fletching", seg=1, name="fletching"))
    lay.add(Prim("box", (r * 0.8, r * 6, L * 0.2), (0, 0, -L * 0.4), slot="fletching", seg=1, name="fletching2"))
    _centre(lay)
    return lay


@body_plan("shell", "projectile", {"radius": P(0.09, 0.03, 0.2)}, attachments=[], slots=["body"], doc="""
shell -- a cannonball. An iron sphere, nothing else; it reads as a dot.
""")
def shell(p: dict, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("sphere", (p["radius"],), (0, 0, 0), slot="body", seg=7, smooth=True, name="ball"))
    _centre(lay)
    return lay


@body_plan("orb", "projectile", {"radius": P(0.09, 0.03, 0.25), "stretch": P(1.6, 1.0, 3.0, doc="Length along the flight, as a multiple of the radius.")},
           attachments=[], slots=["core", "halo"], doc="""
orb -- a glowing core with a darker rim round its flight axis: the frost
bolt when stretched, a hit burst when round.
""")
def orb(p: dict, rng) -> Layout:
    lay = Layout()
    r = p["radius"]
    lay.add(Prim("octa", (r * 0.75,), (0, 0, 0), scale=(1, 1, p["stretch"]), slot="core", seg=1, name="core"))
    lay.add(Prim("torus", (r * 0.85, r * 0.16), (0, 0, 0), (math.pi / 2, 0, 0), scale=(1, 1, 1), slot="halo", seg=6, name="rim"))
    _centre(lay)
    return lay


@body_plan("tile_flat", "tile", {
    "inset": P(0.02, 0.0, 0.1, doc="Gap to the tile edge."),
    "size": P(1, 1, 2, doc="Tiles per side: 1 for a lane tile, 2 for a tower footprint."),
}, attachments=[], slots=["face"], doc="""
tile_flat -- a `size` × `size` slab, 2 cm thick: a lane tile at 1, a tower
footprint at 2 (the placement cursor). Colour comes from the palette role.
""")
def tile_flat(p: dict, rng) -> Layout:
    lay = Layout()
    s = p["size"] - 2 * p["inset"]
    lay.add(Prim("box", (s, 0.02, s), (0, 0.01, 0), slot="face", seg=1, name="face"))
    lay.height = 0.02
    lay.footprint = s
    return lay


@body_plan("tile_marker", "tile", {
    "rune": P("arrow", enum=("arrow", "cross", "ring", "chevron"), doc="The glyph raised on the tile."),
    "height": P(0.03, 0.01, 0.2, doc="How far the glyph stands above the slab."),
    "size": P(1, 1, 2, doc="Tiles per side: 1 for a zone marker, 2 for a tower footprint."),
}, attachments=[], slots=["face", "rune"], doc="""
tile_marker -- a slab with a raised glyph: an arrow for the spawn seam, a
ring for the exit seam, a cross for a refused footprint, a chevron for the
leak marker. The glyph is the glow material so it reads on any turf. At
`size` 2 the slab and the glyph cover a tower's footprint.
""")
def tile_marker(p: dict, rng) -> Layout:
    lay = Layout()
    h = p["height"]
    size = p["size"]
    lay.add(Prim("box", (0.96 * size, 0.02, 0.96 * size), (0, 0.01, 0), slot="face", seg=1, name="face"))
    k = p["rune"]
    if k == "arrow":
        lay.add(Prim("box", (0.12, h, 0.4), (0, 0.02 + h / 2, -0.1), slot="rune", seg=1, name="stem"))
        # A flat triangle: a three-sided prism standing on Y, one vertex toward +Z.
        lay.add(Prim("cyl", (0.26, 0.26, h), (0, 0.02 + h / 2, 0.22), (0, math.pi / 2, 0), slot="rune", seg=3, name="tip"))
    elif k == "cross":
        for a in (0.785, -0.785):
            lay.add(Prim("box", (0.12, h, 0.7), (0, 0.02 + h / 2, 0), (0, a, 0), slot="rune", seg=1, name="bar"))
    elif k == "ring":
        lay.add(Prim("torus", (0.28, 0.05), (0, 0.02 + h / 2, 0), scale=(1, h / 0.1, 1), slot="rune", seg=10, name="ring"))
    else:  # chevron
        for side in (-1, 1):
            lay.add(Prim("box", (0.1, h, 0.45), (side * 0.15, 0.02 + h / 2, 0), (0, side * 0.6, 0), slot="rune", seg=1, name="arm"))
    lay.height = 0.02 + h
    lay.footprint = 0.96 * size
    if size != 1:
        # The glyph was drawn for one tile; scale it to the slab, keeping the
        # slab's own thickness.
        glyph = [q for q in lay.prims if q.slot == "rune"]
        lay.prims = [q for q in lay.prims if q.slot != "rune"]
        grown = Layout(prims=glyph).placed((0.0, 0.0, 0.0), scale=size)
        for q in grown.prims:
            lay.add(q)
    return lay
