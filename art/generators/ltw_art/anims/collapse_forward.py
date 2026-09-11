from __future__ import annotations

import math

from ..mathx import ease_in_quad, frames_for, smoothstep
from ..params import P
from ..registry import animation
from .clip import Clip, has

PARAMS = {
    "duration": P(0.8, 0.3, 2.0, doc="Seconds from the last step to lying still."),
    "impact": P(0.6, 0.1, 0.95, doc="Normalised time the body hits the ground; the `impact` marker."),
    "sink": P(0.0, 0.0, 0.5, doc="How far below ground the root ends, so a corpse can settle into the turf."),
    "drop": P(0.3, 0.0, 0.8, doc="How far the body drops as the legs fold, as a fraction of the model height."),
    "roll": P(0.9, 0.0, 1.6, doc="How far it rolls onto its side after the impact, radians."),
}


@animation("collapse_forward", clips=["Death"], loop=True and False, params=PARAMS, doc="""
The creature's legs fold and the body drops, it pitches forward a little,
hits the ground at the impact marker and rolls onto its side. The last frame
is held by the client as the corpse. Works on any rig with a root; uses
legs, head and tail when present. The pitch is small on purpose: the root is
at the feet, so a large pitch there stands the model on its nose.
""")
def build(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Death", fps, n, loop=False, markers={"impact": p["impact"]})
    imp = p["impact"]
    for f in range(n + 1):
        t = f / n
        fall = smoothstep(t / imp) if t < imp else 1.0
        settle = smoothstep((t - imp) / max(1e-6, 1 - imp)) if t >= imp else 0.0
        height = p.get("_height", 0.5)
        pitch = 0.3 * fall  # nose down, a little
        drop = -height * p["drop"] * ease_in_quad(fall) - p["sink"] * settle
        bounce = 0.03 * math.sin(min(1.0, settle * 3) * math.pi) if t >= imp else 0.0
        roll = p["roll"] * smoothstep(settle)
        c.key("root", f, loc=(0, drop + bounce, 0), rot=(pitch, 0, roll))
        for leg in ("fl", "fr", "bl", "br", "l", "r"):
            if has(bones, f"thigh_{leg}"):
                c.key(f"thigh_{leg}", f, rot=(0.9 * fall if leg.startswith("b") else -0.6 * fall, 0, 0))
            if has(bones, f"shin_{leg}"):
                c.key(f"shin_{leg}", f, rot=(1.3 * fall, 0, 0))
        if has(bones, "head"):
            c.key("head", f, rot=(-0.6 * fall + 0.3 * settle, 0, 0))
        if has(bones, "neck"):
            c.key("neck", f, rot=(0.3 * fall, 0, 0))
        if has(bones, "tail_1"):
            c.key("tail_1", f, rot=(0.8 * fall, 0, 0))
    return c
