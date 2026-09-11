"""
insect -- the swarm creep: a beetle. Low, wide, longer than tall, six (or
more) legs, a shell over most of the body, mandibles. Small on purpose:
the archetype ships in numbers and reads as a texture of moving dots.
"""

from __future__ import annotations

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground

PARAMS = {
    "height": P(0.36, 0.15, 0.9, doc="Height to the top of the shell."),
    "body_length": P(0.5, 0.2, 1.2),
    "legs": P(6, 4, 8, doc="Leg count, always even."),
    "shell_ratio": P(0.7, 0.4, 1.0, doc="How much of the body the shell covers."),
    "mandibles": P(True),
    "seed": SEED,
}


@body_plan("insect", "creep", PARAMS, attachments=["head", "back", "abdomen", "shoulders"],
           slots=["shell", "belly", "torso_stripe", "head_crest", "legs", "eyes"], doc=__doc__ or "")
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h, L = p["height"], p["body_length"]
    n = int(p["legs"]) // 2 * 2
    ry = h * 0.42
    cy = h * 0.55
    rx = L * 0.3
    lay.add(Prim("sphere", (rx,), (0, cy, -L * 0.1), scale=(1.0, ry / rx, L * 0.55 / rx), slot="shell", seg=12, bone="abdomen", smooth=True, name="abdomen"))
    lay.add(Prim("sphere", (rx * 0.8,), (0, cy * 0.95, L * 0.28), scale=(1.0, ry * 0.85 / (rx * 0.8), 0.9), slot="shell", seg=10, bone="thorax", smooth=True, name="thorax"))
    lay.add(Prim("box", (rx * 0.95, ry * 0.3, L * 0.55), (0, cy + ry * 0.78, -L * 0.05), slot="torso_stripe", seg=1, bone="abdomen", name="stripe"))
    lay.add(Prim("box", (rx * 1.6, ry * 0.5, L * 0.6), (0, cy - ry * 0.7, -L * 0.05), slot="belly", seg=1, bone="abdomen", name="belly"))
    hr = rx * 0.5
    head = (0, cy * 0.8, L * 0.5 + hr * 0.6)
    lay.add(Prim("sphere", (hr,), head, slot="belly", seg=8, bone="head", smooth=True, name="head"))
    lay.add(Prim("box", (hr * 0.4, hr * 0.2, hr * 0.6), (0, head[1] + hr * 0.8, head[2]), slot="head_crest", seg=1, bone="head", name="head_crest"))
    if p["mandibles"]:
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.2, hr * 1.2), (side * hr * 0.4, head[1] - hr * 0.2, head[2] + hr * 1.0), (-1.4, 0, side * 0.4), slot="legs", seg=5, bone="head", name="mandible"))
    eyes(lay, (0, head[1] + hr * 0.25, head[2] + hr * 0.7), hr * 0.45, hr * 0.2, "head")
    per_side = n // 2
    for i in range(per_side):
        t = (i + 0.5) / per_side
        z = L * 0.35 - t * L * 0.7
        for side_name, side in (("l", -1), ("r", 1)):
            bone = f"leg_{side_name}{i + 1}"
            lay.add(Prim("box", (rx * 1.2, ry * 0.18, rx * 0.22), (side * rx * 0.95, cy * 0.6, z), (0, (t - 0.5) * 0.9 * side, side * 0.45), slot="legs", seg=1, bone=bone, name=f"leg_{side_name}{i}"))
            lay.add(Prim("box", (rx * 0.2, cy * 0.7, rx * 0.2), (side * rx * 1.5, cy * 0.3, z), (0, 0, side * 0.15), slot="legs", seg=1, bone=bone, name=f"shin_{side_name}{i}"))
            lay.joint(bone, (side * rx * 0.6, cy * 0.6, z))
            lay.joint(f"{bone}_tip", (side * rx * 1.6, 0.0, z))
    for i in range(per_side, 4):
        for side_name, side in (("l", -1), ("r", 1)):
            bone = f"leg_{side_name}{i + 1}"
            lay.joint(bone, (side * rx * 0.3, cy * 0.5, -L * 0.3))
            lay.joint(f"{bone}_tip", (side * rx * 0.3, cy * 0.4, -L * 0.3))
    lay.joint("thorax", (0, cy, L * 0.2))
    lay.joint("head", head)
    lay.joint("head_tip", (head[0], head[1], head[2] + hr))
    lay.joint("abdomen", (0, cy, -L * 0.05))
    lay.joint("abdomen_tip", (0, cy, -L * 0.45))
    lay.attach(Attachment("head", (0, head[1] + hr * 0.8, head[2]), size=hr * 2, bone="head"))
    lay.attach(Attachment("back", (0, cy + ry, -L * 0.1), size=rx * 1.5, bone="abdomen"))
    lay.attach(Attachment("abdomen", (0, cy + ry * 0.7, -L * 0.3), rot=(-0.5, 0, 0), size=rx * 1.5, bone="abdomen"))
    lay.attach(Attachment("shoulders", (0, cy + ry * 0.8, L * 0.25), size=rx * 1.4, bone="thorax"))
    ground(lay)
    return lay
