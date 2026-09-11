"""
blob -- a slime: a squashed sphere with a few lumps, a glowing core, no
limbs. The rig is four bones (root, core, top, front, back) so it can
squash, stretch and ooze.
"""

from __future__ import annotations

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground

PARAMS = {
    "height": P(0.4, 0.2, 1.0, doc="Height of the body."),
    "squash": P(0.7, 0.3, 1.2, doc="Height / width ratio."),
    "lumps": P(3, 0, 8, doc="Extra bumps on the surface."),
    "seed": SEED,
}


@body_plan("blob", "creep", PARAMS, attachments=["top", "front", "back"],
           slots=["skin", "core", "torso_stripe", "eyes"], doc=__doc__ or "")
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h = p["height"]
    r = h / (2 * p["squash"])
    cy = h / 2
    lay.add(Prim("sphere", (r,), (0, cy, 0), scale=(1, p["squash"], 1), slot="skin", seg=12, bone="core", smooth=True, name="body"))
    lay.add(Prim("sphere", (r * 0.45,), (0, cy * 0.9, 0), slot="core", seg=8, bone="core", smooth=True, name="core"))
    lay.add(Prim("box", (r * 0.4, h * 0.25, r * 0.5), (0, cy + h * 0.32, -r * 0.2), slot="torso_stripe", seg=1, bone="top", name="stripe"))
    for i in range(int(p["lumps"])):
        a = rng.random() * 6.283
        lr = r * (0.25 + rng.random() * 0.2)
        import math

        x, z = math.cos(a) * r * 0.7, math.sin(a) * r * 0.7
        y = cy + (rng.random() - 0.3) * h * 0.4
        bone = "front" if z > 0 else "back"
        lay.add(Prim("sphere", (lr,), (x, y, z), slot="skin", seg=8, bone=bone, smooth=True, name=f"lump_{i}"))
    eyes(lay, (0, cy + h * 0.15, r * 0.75), r * 0.3, r * 0.14, "front")
    lay.joint("core", (0, cy, 0))
    lay.joint("top", (0, h, 0))
    lay.joint("front", (0, cy, r))
    lay.joint("back", (0, cy, -r))
    lay.attach(Attachment("top", (0, h, 0), size=r * 1.5, bone="top"))
    lay.attach(Attachment("front", (0, cy, r), rot=(1.2, 0, 0), size=r, bone="front"))
    lay.attach(Attachment("back", (0, cy + h * 0.2, -r * 0.8), rot=(-0.8, 0, 0), size=r * 1.5, bone="back"))
    ground(lay)
    return lay
