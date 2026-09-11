"""
biped_lean -- a lean two-legged runner: long legs, narrow torso, a low
forward lean, small head out front. The lean is the silhouette: the torso is
pitched forward so the profile reads as a diagonal line, not a post.
"""

from __future__ import annotations

import math

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground, leg

PARAMS = {
    "height": P(0.55, 0.3, 1.2, doc="Standing height to the top of the head."),
    "leg_length": P(0.28, 0.1, 0.7, doc="Hip to ground."),
    "torso_width": P(0.18, 0.08, 0.5),
    "torso_length": P(0.3, 0.15, 0.8, doc="Hip to neck, along the leaning spine."),
    "head": P("fox", enum=("fox", "hound", "raptor", "imp"), doc="Head shape."),
    "lean": P(0.55, 0.0, 1.0, doc="Forward pitch of the torso, radians."),
    "arms": P(True, doc="Short arms held forward, or none."),
    "seed": SEED,
}


@body_plan("biped_lean", "creep", PARAMS,
           attachments=["head", "back", "shoulders", "tail", "hips"],
           slots=["skin", "belly", "torso_stripe", "head_crest", "limbs", "eyes"], doc=__doc__ or "")
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h, ll, tw, tl, lean = p["height"], p["leg_length"], p["torso_width"], p["torso_length"], p["lean"]
    hip_y = ll
    # Torso: a capsule from the hips up and forward along the lean.
    dz, dy = math.sin(lean) * tl, math.cos(lean) * tl
    neck = (0.0, hip_y + dy, dz)
    mid = (0.0, hip_y + dy / 2, dz / 2)
    r = tw / 2
    lay.add(Prim("capsule", (r, tl * 0.8), mid, (lean, 0, 0), slot="skin", seg=10, bone="spine", blend="chest", smooth=True, name="torso"))
    lay.add(Prim("box", (tw * 0.55, tl * 0.6, r * 0.5), (0, mid[1] - r * 0.5 * math.cos(lean), mid[2] + r * 0.6), (lean, 0, 0), slot="belly", seg=1, bone="spine", blend="chest", name="belly"))
    lay.add(Prim("box", (tw * 0.35, tl * 0.65, r * 0.3), (0, mid[1] + r * 0.85 * math.cos(lean), mid[2] - r * 0.7 * math.sin(lean)), (lean, 0, 0), slot="torso_stripe", seg=1, bone="spine", blend="chest", name="stripe"))
    # Head: small, out front, above the neck.
    hr = r * 1.15
    head = (0.0, neck[1] + hr * 0.6, neck[2] + hr * 0.5)
    lay.add(Prim("sphere", (hr,), head, scale=(1, 0.9, 1.1), slot="skin", seg=10, bone="head", smooth=True, name="head"))
    kind = p["head"]
    if kind in ("fox", "hound"):
        sn = hr * (1.3 if kind == "fox" else 1.0)
        lay.add(Prim("box", (hr * 0.8, hr * 0.6, sn), (0, head[1] - hr * 0.25, head[2] + hr * 0.9), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.32, hr * 0.9), (side * hr * 0.5, head[1] + hr * 0.85, head[2] - hr * 0.2), (-0.35, 0, side * 0.3), slot="skin", seg=5, bone="head", name="ear"))
    elif kind == "raptor":
        lay.add(Prim("box", (hr * 0.7, hr * 0.5, hr * 1.7), (0, head[1] - hr * 0.2, head[2] + hr * 1.1), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        lay.add(Prim("box", (hr * 0.25, hr * 0.6, hr * 0.8), (0, head[1] + hr * 0.85, head[2] - hr * 0.3), slot="head_crest", seg=1, bone="head", name="crest"))
    else:  # imp
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.25, hr * 0.9), (side * hr * 0.55, head[1] + hr * 0.8, head[2]), (0.2, 0, side * 0.6), slot="bone", seg=5, bone="head", name="horn"))
        lay.add(Prim("box", (hr * 0.9, hr * 0.35, hr * 0.7), (0, head[1] - hr * 0.35, head[2] + hr * 0.8), slot="belly", seg=1, bone="head", name="jaw"))
    eyes(lay, (0, head[1] + hr * 0.15, head[2] + hr * 0.8), hr * 0.42, hr * 0.17, "head")
    lay.add(Prim("box", (hr * 0.35, hr * 0.25, hr * 0.5), (0, head[1] + hr * 0.85, head[2]), slot="head_crest", seg=1, bone="head", name="head_crest"))
    # Legs: long, knees forward.
    hx = tw * 0.4
    for name in ("l", "r"):
        side = -1 if name == "l" else 1
        top = (side * hx, hip_y, 0.0)
        knee = (side * hx, hip_y * 0.5, 0.06)
        foot = (side * hx, 0.0, 0.0)
        leg(lay, name, top, knee, foot, r * 0.45, r * 0.35, "limbs", seg=6)
        lay.add(Prim("box", (r * 0.7, r * 0.35, r * 1.2), (side * hx, r * 0.18, r * 0.35), slot="limbs", seg=1, bone=f"shin_{name}", bevel=0.01, name=f"foot_{name}"))
    # Arms: short, forward.
    if p["arms"]:
        for name in ("l", "r"):
            side = -1 if name == "l" else 1
            sh = (side * (r + 0.02), neck[1] - r * 0.3, neck[2] - r * 0.2)
            hand = (side * (r + 0.02), sh[1] - tl * 0.35, sh[2] + tl * 0.3)
            lay.add(Prim("cyl", (r * 0.28, r * 0.32, math.dist(sh, hand)), ((sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2, (sh[2] + hand[2]) / 2), (math.atan2(hand[2] - sh[2], hand[1] - sh[1]) + math.pi, 0, 0), slot="limbs", seg=6, bone=f"upper_arm_{name}", blend=f"forearm_{name}", name=f"arm_{name}"))
            lay.joint(f"shoulder_{name}", sh)
            lay.joint(f"elbow_{name}", ((sh[0] + hand[0]) / 2, (sh[1] + hand[1]) / 2, (sh[2] + hand[2]) / 2))
            lay.joint(f"hand_{name}", hand)
    else:
        for name in ("l", "r"):
            side = -1 if name == "l" else 1
            lay.joint(f"shoulder_{name}", (side * r, neck[1], neck[2]))
            lay.joint(f"elbow_{name}", (side * r, neck[1] - 0.05, neck[2]))
            lay.joint(f"hand_{name}", (side * r, neck[1] - 0.1, neck[2]))
    # Tail: a cone back and down from the hips, balancing the lean.
    tail_base = (0.0, hip_y + r * 0.2, -r * 0.6)
    lay.add(Prim("cone", (r * 0.45, tl * 0.9), (0, hip_y + r * 0.1, -r * 0.6 - tl * 0.4), (-math.pi / 2 - 0.25, 0, 0), slot="skin", seg=6, bone="tail_1", blend="tail_2", name="tail"))
    lay.joint("tail_base", tail_base)
    lay.joint("tail_mid", (0.0, hip_y, tail_base[2] - tl * 0.4))
    lay.joint("tail_tip", (0.0, hip_y - r * 0.4, tail_base[2] - tl * 0.85))
    # Rig landmarks.
    lay.joint("hips", (0.0, hip_y, 0.0))
    lay.joint("spine", mid)
    lay.joint("chest", (0.0, hip_y + dy * 0.8, dz * 0.8))
    lay.joint("neck", neck)
    lay.joint("head", head)
    lay.joint("head_tip", (head[0], head[1] + hr * 0.3, head[2] + hr * 1.4))
    lay.attach(Attachment("head", (0, head[1] + hr * 0.9, head[2]), size=hr * 2, bone="head"))
    lay.attach(Attachment("shoulders", (0, neck[1] + r * 0.6, neck[2] - r * 0.3), rot=(lean, 0, 0), size=tw, bone="chest"))
    lay.attach(Attachment("back", (0, mid[1] + r * 0.9, mid[2] - r * 0.4), rot=(lean, 0, 0), size=tw, bone="spine"))
    lay.attach(Attachment("hips", (0, hip_y + r * 0.8, -r * 0.2), size=tw, bone="hips"))
    lay.attach(Attachment("tail", tail_base, size=tw, bone="tail_1"))
    ground(lay)
    return lay
