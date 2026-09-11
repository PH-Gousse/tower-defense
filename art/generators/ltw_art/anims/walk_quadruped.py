from __future__ import annotations

import math

from ..mathx import frames_for, loop_cos, loop_sin
from ..params import P
from ..registry import animation
from .clip import Clip, has

PARAMS = {
    "stride": P(1.0, 0.1, 3.0, doc="Tiles covered per cycle if the creature moved; the client divides speed by this."),
    "cadence": P(2.5, 0.5, 8.0, doc="Cycles per second at the creature's natural speed."),
    "bob": P(0.04, 0.0, 0.15, doc="Body rise per step, in tiles."),
    "swing": P(0.55, 0.1, 1.2, doc="Leg swing amplitude, radians."),
    "gait": P("trot", enum=("walk", "trot", "gallop"), doc="Which legs move together."),
}

# Phase offset of each leg within the cycle, per gait.
GAITS = {
    "walk": {"fl": 0.0, "br": 0.25, "fr": 0.5, "bl": 0.75},
    "trot": {"fl": 0.0, "br": 0.0, "fr": 0.5, "bl": 0.5},
    "gallop": {"fl": 0.0, "fr": 0.12, "bl": 0.5, "br": 0.62},
}


@animation("walk_quadruped", clips=["Walk"], loop=True, params=PARAMS, doc="""
A four-legged walk cycle in place: thighs swing fore and aft, shins fold on
the forward swing so the foot clears the ground, the body bobs twice a
cycle, the head counter-nods and the tail wags. One cycle is two steps of
each leg. The `stride` parameter is not used by the clip itself -- it is
recorded so the client can scale the loop to the creature's speed.
""")
def build(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(1.0 / p["cadence"], fps)
    c = Clip("Walk", fps, n, loop=True, stride=p["stride"])
    A = p["swing"]
    phases = GAITS[p["gait"]]
    for f in range(n):
        ph = f / n
        for leg, off in phases.items():
            if not has(bones, f"thigh_{leg}", f"shin_{leg}"):
                continue
            s = loop_sin(ph + off)  # +1 = forward
            fwd = loop_cos(ph + off)  # forward swing happens while cos > 0
            # Thigh swings about X: a positive X rotation pitches +Z (forward) down,
            # so a forward swing is negative for a leg hanging from the body.
            c.key(f"thigh_{leg}", f, rot=(-A * s, 0, 0))
            # Knee folds only during the forward swing.
            fold = max(0.0, fwd) * A * 1.2
            c.key(f"shin_{leg}", f, rot=(fold, 0, 0))
        bob = p["bob"] * (0.5 - 0.5 * loop_cos(ph, 2.0))
        c.key("root", f, loc=(0, bob, 0), rot=(0.03 * loop_sin(ph, 2.0), 0, 0.02 * loop_sin(ph)))
        if has(bones, "head"):
            c.key("head", f, rot=(0.08 * loop_sin(ph + 0.25, 2.0), 0, 0))
        if has(bones, "tail_1"):
            c.key("tail_1", f, rot=(0, 0.25 * loop_sin(ph), 0))
        if has(bones, "tail_2"):
            c.key("tail_2", f, rot=(0, 0.25 * loop_sin(ph - 0.15), 0))
        if has(bones, "spine"):
            c.key("spine", f, rot=(0, 0.04 * loop_sin(ph), 0))
    return c
