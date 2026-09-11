"""
hover -- a floating creature: a bell (jellyfish) or a balloon body with
tendrils hanging below, no legs, clear of the ground by `hover_height`.
The rig is root/body/bell/tendrils; hover_bob drives Idle and Walk.
"""

from __future__ import annotations

import math

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground

PARAMS = {
    "height": P(0.6, 0.3, 1.2, doc="Top of the bell above the ground, including hover_height."),
    "hover_height": P(0.25, 0.05, 0.6, doc="Gap between the ground and the lowest tendril."),
    "bell_radius": P(0.22, 0.1, 0.5),
    "tendrils": P(5, 0, 12),
    "seed": SEED,
}


@body_plan("hover", "creep", PARAMS, attachments=["top", "front", "back", "underside"],
           slots=["skin", "belly", "torso_stripe", "tendrils", "eyes"], doc=__doc__ or "")
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h, hh, br = p["height"], p["hover_height"], p["bell_radius"]
    bell_y = h - br * 0.6
    lay.add(Prim("sphere", (br,), (0, bell_y, 0), scale=(1, 0.75, 1), slot="skin", seg=12, bone="bell", smooth=True, name="bell"))
    lay.add(Prim("cyl", (br * 0.9, br * 0.55, br * 0.5), (0, bell_y - br * 0.45, 0), slot="belly", seg=12, bone="body", name="skirt"))
    lay.add(Prim("box", (br * 0.35, br * 0.25, br * 1.2), (0, bell_y + br * 0.7, 0), slot="torso_stripe", seg=1, bone="bell", name="stripe"))
    n = int(p["tendrils"])
    bottom = bell_y - br * 0.7
    length = max(0.05, bottom - hh)
    for i in range(n):
        a = i / max(1, n) * math.tau
        x, z = math.cos(a) * br * 0.55, math.sin(a) * br * 0.55
        lay.add(Prim("cyl", (br * 0.05, br * 0.09, length * (0.75 + 0.25 * rng.random())), (x, bottom - length * 0.45, z), (0.1 * math.sin(a), 0, -0.1 * math.cos(a)), slot="tendrils", seg=5, bone="tendrils", name=f"tendril_{i}"))
    eyes(lay, (0, bell_y - br * 0.15, br * 0.8), br * 0.35, br * 0.13, "bell")
    lay.joint("body", (0, bottom, 0))
    lay.joint("bell", (0, bell_y, 0))
    lay.joint("bell_top", (0, h, 0))
    lay.joint("tendrils_tip", (0, hh, 0))
    lay.attach(Attachment("top", (0, h, 0), size=br * 1.5, bone="bell"))
    lay.attach(Attachment("front", (0, bell_y, br), rot=(1.3, 0, 0), size=br, bone="bell"))
    lay.attach(Attachment("back", (0, bell_y + br * 0.3, -br * 0.8), rot=(-0.9, 0, 0), size=br * 1.5, bone="bell"))
    lay.attach(Attachment("underside", (0, bottom, 0), rot=(math.pi, 0, 0), size=br, bone="body"))
    # A hover creature does not touch the ground: keep the gap rather than
    # grounding it, but still centre the footprint.
    lo, hi = lay.bounds()
    moved = lay.placed((-(lo[0] + hi[0]) / 2, 0, -(lo[2] + hi[2]) / 2))
    lay.prims, lay.attachments, lay.joints = moved.prims, moved.attachments, moved.joints
    lay.height = float(hi[1])
    lay.footprint = float(max(hi[0] - lo[0], hi[2] - lo[2]))
    return lay
