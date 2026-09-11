"""
quadruped -- a four-legged runner. Long body, low head out front, tail up.
The runner archetype's silhouette rule is "lean, forward-leaning, a
horizontal line", so the body is a capsule longer than it is tall, the legs
are thin, and the head sits below the shoulder line.
"""

from __future__ import annotations

import math

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import eyes, ground, leg

PARAMS = {
    "height": P(0.55, 0.25, 1.2, doc="Standing height to the top of the back, in tiles."),
    "body_length": P(0.5, 0.2, 1.2, doc="Shoulder to hip, in tiles."),
    "leg_length": P(0.24, 0.08, 0.6, doc="Hip to ground."),
    "body_radius": P(0.11, 0.05, 0.3, doc="Torso thickness."),
    "head": P("hound", enum=("hound", "boar", "lizard"), doc="Head shape."),
    "head_size": P(1.0, 0.6, 1.6, doc="Head scale relative to the body radius."),
    "tail": P("up", enum=("up", "down", "none")),
    "seed": SEED,
}


@body_plan(
    "quadruped",
    "creep",
    PARAMS,
    attachments=["head", "back", "shoulders", "tail", "hips"],
    slots=["skin", "belly", "torso_stripe", "head_crest", "limbs", "eyes"],
    doc=__doc__ or "",
)
def build(p: dict, rng) -> Layout:
    lay = Layout()
    h = p["height"]
    L = p["body_length"]
    leg_len = p["leg_length"]
    r = p["body_radius"]
    hs = p["head_size"]
    skin, limbs = "skin", "limbs"

    back_y = h  # top of the back
    body_y = back_y - r
    # Body: a capsule along +Z (forward). Capsule axis is local Y, so pitch
    # it 90 degrees about X.
    lay.add(Prim("capsule", (r, L), (0, body_y, 0), (math.pi / 2, 0, 0), slot=skin, seg=10, bone="spine", blend="chest", smooth=True, name="body"))
    # A pale belly stripe under the body, and the team stripe along the back.
    lay.add(Prim("box", (r * 1.2, r * 0.5, L * 0.7), (0, body_y - r * 0.55, 0), slot="belly", seg=1, bone="spine", blend="chest", name="belly"))
    lay.add(Prim("box", (r * 0.5, r * 0.35, L * 0.75), (0, back_y - r * 0.15, 0), slot="torso_stripe", seg=1, bone="spine", blend="chest", name="stripe"))

    # Head, out front and a little below the shoulder line.
    hz = L / 2 + r * 0.9
    hy = body_y + r * 0.35 * hs
    hr = r * 0.95 * hs
    lay.add(Prim("sphere", (hr,), (0, hy, hz), scale=(1, 0.95, 1.1), slot=skin, seg=10, bone="head", smooth=True, name="head"))
    if p["head"] == "hound":
        lay.add(Prim("box", (hr * 1.1, hr * 0.8, hr * 1.3), (0, hy - hr * 0.2, hz + hr * 0.9), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.35, hr * 0.9), (side * hr * 0.55, hy + hr * 0.9, hz - hr * 0.2), (-0.3, 0, side * 0.35), slot=skin, seg=5, bone="head", name="ear"))
    elif p["head"] == "boar":
        lay.add(Prim("box", (hr * 1.3, hr * 0.9, hr * 1.1), (0, hy - hr * 0.3, hz + hr * 0.8), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        for side in (-1, 1):
            lay.add(Prim("cone", (hr * 0.18, hr * 0.7), (side * hr * 0.5, hy - hr * 0.4, hz + hr * 1.1), (-1.2, 0, side * 0.5), slot="bone", seg=5, bone="head", name="tusk"))
    else:  # lizard
        lay.add(Prim("box", (hr * 1.0, hr * 0.5, hr * 1.6), (0, hy - hr * 0.35, hz + hr * 1.0), slot="belly", seg=1, bone="head", bevel=0.01, name="snout"))
        lay.add(Prim("box", (hr * 0.25, hr * 0.5, hr * 0.9), (0, hy + hr * 0.8, hz - hr * 0.2), slot="head_crest", seg=1, bone="head", name="crest"))
    eyes(lay, (0, hy + hr * 0.25, hz + hr * 0.75), hr * 0.45, hr * 0.18, "head")
    lay.add(Prim("box", (hr * 0.4, hr * 0.25, hr * 0.5), (0, hy + hr * 0.85, hz + hr * 0.1), slot="head_crest", seg=1, bone="head", name="head_crest"))

    # Legs: two pairs, thin, planted a little wider than the body.
    lx = r * 0.85
    for name, z in (("fl", L / 2 - r * 0.3), ("fr", L / 2 - r * 0.3), ("bl", -L / 2 + r * 0.3), ("br", -L / 2 + r * 0.3)):
        side = -1 if name.endswith("l") else 1
        top = (side * lx, body_y - r * 0.2, z)
        knee = (side * lx, body_y - r * 0.2 - leg_len * 0.5, z + (0.04 if name.startswith("f") else -0.04))
        foot = (side * lx, 0.0, z)
        leg(lay, name, top, knee, foot, r * 0.32, r * 0.26, limbs, seg=6)
        lay.add(Prim("box", (r * 0.55, r * 0.3, r * 0.7), (side * lx, r * 0.15, z + r * 0.15), slot=limbs, seg=1, bone=f"shin_{name}", bevel=0.01, name=f"paw_{name}"))

    # Tail.
    tz = -L / 2 - r * 0.3
    if p["tail"] != "none":
        up = 1.0 if p["tail"] == "up" else -0.4
        lay.add(Prim("cone", (r * 0.35, L * 0.55), (0, body_y + r * 0.25 * up + (0.2 * L * up if up > 0 else 0), tz - L * 0.15), (-math.pi / 2 + 0.9 * up, 0, 0), slot=skin, seg=6, bone="tail_1", blend="tail_2", name="tail"))
        lay.joint("tail_base", (0, body_y + r * 0.2, tz))
        lay.joint("tail_mid", (0, body_y + r * 0.2 + 0.18 * L * up, tz - L * 0.2))
        lay.joint("tail_tip", (0, body_y + r * 0.2 + 0.4 * L * up, tz - L * 0.35))
    else:
        lay.joint("tail_base", (0, body_y, tz))
        lay.joint("tail_mid", (0, body_y, tz - 0.05))
        lay.joint("tail_tip", (0, body_y, tz - 0.1))

    # Rig landmarks.
    lay.joint("hips", (0, body_y, -L / 2 + r * 0.3))
    lay.joint("spine", (0, body_y, 0))
    lay.joint("chest", (0, body_y, L / 2 - r * 0.3))
    lay.joint("neck", (0, body_y + r * 0.2, L / 2 + r * 0.3))
    lay.joint("head", (0, hy, hz))
    lay.joint("head_tip", (0, hy, hz + hr * 1.5))

    # Attachment points for the part library.
    lay.attach(Attachment("head", (0, hy + hr * 0.9, hz), size=hr * 2, bone="head"))
    lay.attach(Attachment("shoulders", (0, back_y, L / 2 - r * 0.5), size=r * 2, bone="chest"))
    lay.attach(Attachment("back", (0, back_y, 0), size=r * 2, bone="spine"))
    lay.attach(Attachment("hips", (0, back_y, -L / 2 + r * 0.4), size=r * 2, bone="hips"))
    lay.attach(Attachment("tail", (0, body_y + r * 0.2, tz), size=r * 2, bone="tail_1"))
    ground(lay)
    return lay
