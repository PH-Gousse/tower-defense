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
orb -- a frost bolt: a glowing octahedron stretched along its flight.
""")
def orb(p: dict, rng) -> Layout:
    lay = Layout()
    r = p["radius"]
    lay.add(Prim("octa", (r,), (0, 0, 0), scale=(1, 1, p["stretch"]), slot="core", seg=1, name="core"))
    _centre(lay)
    return lay


@body_plan("tile_flat", "tile", {"inset": P(0.02, 0.0, 0.1, doc="Gap to the tile edge.")}, attachments=[], slots=["face"], doc="""
tile_flat -- a 1 × 1 slab, 2 cm thick, for the entrance and exit tiles and
the blocked-placement preview. Colour comes from the palette role.
""")
def tile_flat(p: dict, rng) -> Layout:
    lay = Layout()
    s = 1.0 - 2 * p["inset"]
    lay.add(Prim("box", (s, 0.02, s), (0, 0.01, 0), slot="face", seg=1, name="face"))
    lay.height = 0.02
    lay.footprint = s
    return lay


@body_plan("tile_marker", "tile", {
    "rune": P("arrow", enum=("arrow", "cross", "ring", "chevron"), doc="The glyph raised on the tile."),
    "height": P(0.03, 0.01, 0.2, doc="How far the glyph stands above the slab."),
}, attachments=[], slots=["face", "rune"], doc="""
tile_marker -- a slab with a raised glyph: an arrow for the entrance, a
ring for the exit, a cross for a blocked tile, a chevron for the leak
marker. The glyph is the glow material so it reads on any turf.
""")
def tile_marker(p: dict, rng) -> Layout:
    lay = Layout()
    h = p["height"]
    lay.add(Prim("box", (0.96, 0.02, 0.96), (0, 0.01, 0), slot="face", seg=1, name="face"))
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
    lay.footprint = 0.96
    return lay
