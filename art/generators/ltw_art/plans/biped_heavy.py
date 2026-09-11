"""
biped_heavy -- the tank: wide, upright, shoulders far wider than the hips,
short thick legs, a small head sunk between the shoulders. The silhouette is
a block with a head; nothing about it is lean.
"""

from __future__ import annotations

import math

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground, leg

PARAMS = {
    "height": P(1.05, 0.6, 1.6, doc="Standing height to the top of the head."),
    "shoulder_width": P(0.62, 0.3, 1.0),
    "hip_width": P(0.34, 0.15, 0.7),
    "arm_thickness": P(0.13, 0.05, 0.3),
    "leg_length": P(0.3, 0.1, 0.6),
    "head": P("brute", enum=("brute", "boar", "golem"), doc="Head shape."),
    "seed": SEED,
}


@body_plan("biped_heavy", "creep", PARAMS,
           attachments=["head", "back", "shoulders", "shoulder_l", "shoulder_r", "hips", "hand_l", "hand_r"],
           slots=["skin", "belly", "torso_stripe", "head_crest", "cloth", "limbs", "eyes"], doc=__doc__ or "")
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h, sw, hw, at, ll = p["height"], p["shoulder_width"], p["hip_width"], p["arm_thickness"], p["leg_length"]
    hip_y = ll
    torso_h = h * 0.42
    chest_y = hip_y + torso_h
    # Torso: a box widening upward, as two boxes.
    lay.add(Prim("box", (hw * 1.05, torso_h * 0.5, hw * 0.9), (0, hip_y + torso_h * 0.25, 0), slot="cloth", seg=1, bone="hips", blend="spine", bevel=0.02, name="hips"))
    lay.add(Prim("box", (sw * 0.75, torso_h * 0.6, hw * 1.1), (0, hip_y + torso_h * 0.68, 0), slot="skin", seg=1, bone="spine", blend="chest", bevel=0.03, name="chest"))
    lay.add(Prim("box", (sw * 0.3, torso_h * 0.5, hw * 0.3), (0, hip_y + torso_h * 0.68, hw * 0.5), slot="torso_stripe", seg=1, bone="spine", blend="chest", name="stripe"))
    lay.add(Prim("box", (sw * 0.5, torso_h * 0.35, hw * 0.25), (0, hip_y + torso_h * 0.5, hw * 0.48), slot="belly", seg=1, bone="spine", name="belly"))
    # Shoulders: two big spheres.
    for name in ("l", "r"):
        side = -1 if name == "l" else 1
        sx = side * sw * 0.42
        lay.add(Prim("sphere", (sw * 0.2,), (sx, chest_y - sw * 0.05, 0), slot="skin", seg=10, bone=f"upper_arm_{name}", smooth=True, name=f"shoulder_{name}"))
        # Arm: hangs down and slightly forward, ends in a fist.
        sh = (sx, chest_y - sw * 0.1, 0.0)
        elbow = (sx + side * 0.03, sh[1] - torso_h * 0.45, 0.05)
        hand = (sx + side * 0.04, hip_y + torso_h * 0.05, 0.12)
        for seg_name, a, b, ra, rb in (("upper_arm", sh, elbow, at, at * 0.9), ("forearm", elbow, hand, at * 0.9, at * 0.8)):
            lay.add(_seg(a, b, ra, rb, "skin", f"{seg_name}_{name}"))
        lay.add(Prim("sphere", (at * 1.1,), hand, slot="limbs", seg=8, bone=f"hand_{name}", smooth=True, name=f"fist_{name}"))
        lay.joint(f"shoulder_{name}", sh)
        lay.joint(f"elbow_{name}", elbow)
        lay.joint(f"hand_{name}", hand)
        lay.joint(f"hand_tip_{name}", (hand[0], hand[1] - at, hand[2]))
        lay.attach(Attachment(f"shoulder_{name}", (sx, chest_y + sw * 0.12, 0), size=sw * 0.5, bone=f"upper_arm_{name}"))
        lay.attach(Attachment(f"hand_{name}", hand, size=at * 3, bone=f"hand_{name}"))
    # Head: small, sunk between the shoulders.
    hr = sw * 0.16
    head = (0.0, chest_y + hr * 0.9, hw * 0.15)
    lay.add(Prim("sphere", (hr,), head, slot="skin", seg=10, bone="head", smooth=True, name="head"))
    kind = p["head"]
    if kind == "brute":
        lay.add(Prim("box", (hr * 1.2, hr * 0.5, hr * 0.9), (0, head[1] - hr * 0.5, head[2] + hr * 0.6), slot="belly", seg=1, bone="head", name="jaw"))
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.2, hr * 0.6), (side * hr * 0.45, head[1] - hr * 0.2, head[2] + hr * 0.9), (-0.3, 0, side * 0.2), slot="bone", seg=5, bone="head", name="tusk"))
    elif kind == "boar":
        lay.add(Prim("box", (hr * 1.0, hr * 0.7, hr * 1.2), (0, head[1] - hr * 0.3, head[2] + hr * 0.9), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.18, hr * 0.8), (side * hr * 0.5, head[1] - hr * 0.5, head[2] + hr * 1.2), (-1.3, 0, side * 0.5), slot="bone", seg=5, bone="head", name="tusk"))
    else:  # golem: a cube head
        lay.add(Prim("box", (hr * 2.0, hr * 1.8, hr * 1.8), head, slot="skin", seg=1, bone="head", bevel=0.02, name="head_block"))
    eyes(lay, (0, head[1] + hr * 0.1, head[2] + hr * 0.8), hr * 0.4, hr * 0.16, "head")
    lay.add(Prim("box", (hr * 0.6, hr * 0.3, hr * 0.9), (0, head[1] + hr * 0.9, head[2] - hr * 0.1), slot="head_crest", seg=1, bone="head", name="head_crest"))
    # Legs: short, thick, wide apart.
    for name in ("l", "r"):
        side = -1 if name == "l" else 1
        lx = side * hw * 0.35
        top = (lx, hip_y, 0.0)
        knee = (lx, hip_y * 0.5, 0.03)
        foot = (lx, 0.0, 0.0)
        leg(lay, name, top, knee, foot, hw * 0.2, hw * 0.18, "limbs", seg=7)
        lay.add(Prim("box", (hw * 0.4, hw * 0.16, hw * 0.55), (lx, hw * 0.08, hw * 0.12), slot="limbs", seg=1, bone=f"shin_{name}", bevel=0.01, name=f"foot_{name}"))
    lay.joint("hips", (0.0, hip_y, 0.0))
    lay.joint("spine", (0.0, hip_y + torso_h * 0.45, 0.0))
    lay.joint("chest", (0.0, chest_y - torso_h * 0.15, 0.0))
    lay.joint("neck", (0.0, chest_y, hw * 0.1))
    lay.joint("head", head)
    lay.joint("head_tip", (head[0], head[1] + hr * 1.2, head[2]))
    lay.attach(Attachment("head", (0, head[1] + hr, head[2]), size=hr * 2.2, bone="head"))
    lay.attach(Attachment("shoulders", (0, chest_y + sw * 0.1, 0), size=sw * 0.6, bone="chest"))
    lay.attach(Attachment("back", (0, hip_y + torso_h * 0.7, -hw * 0.55), rot=(-0.4, 0, 0), size=sw * 0.6, bone="spine"))
    lay.attach(Attachment("hips", (0, hip_y + torso_h * 0.2, -hw * 0.5), size=hw, bone="hips"))
    ground(lay)
    return lay


def _seg(a, b, ra, rb, slot, bone):
    from .common import _segment

    return _segment(a, b, ra, rb, slot, 7, bone, 0.0)
