from __future__ import annotations

from ..mathx import frames_for, loop_sin
from ..params import P
from ..registry import animation
from .clip import Clip, has

PARAMS = {
    "amplitude": P(0.02, 0.0, 0.1, doc="Chest rise, in tiles."),
    "duration": P(1.5, 0.5, 4.0, doc="One breath, in seconds."),
    "head_nod": P(0.06, 0.0, 0.3, doc="Head pitch, radians."),
}


@animation("idle_breathe", clips=["Idle"], loop=True, params=PARAMS, doc="""
A breath: the chest (or whatever bone is nearest a chest) rises and falls
once per cycle, the head nods a little late, and nothing else moves. Works
on any rig that has a root; uses chest/neck/head when they exist.
""")
def build(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Idle", fps, n, loop=True)
    for f in range(n):
        ph = f / n
        rise = p["amplitude"] * (0.5 - 0.5 * loop_sin(ph + 0.25))
        if has(bones, "chest"):
            c.key("chest", f, loc=(0, rise, 0), scale=(1 + rise * 0.6, 1, 1 + rise * 0.6))
        else:
            c.key("root", f, loc=(0, rise, 0))
        if has(bones, "head"):
            c.key("head", f, rot=(p["head_nod"] * loop_sin(ph + 0.15) * 0.5, 0, 0))
        if has(bones, "tail_1"):
            c.key("tail_1", f, rot=(0, 0.12 * loop_sin(ph + 0.4), 0))
    return c
