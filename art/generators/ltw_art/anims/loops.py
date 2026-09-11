"""Loop clips: walk_biped, scuttle, hover_bob."""

from __future__ import annotations

from ..mathx import frames_for, loop_cos, loop_sin
from ..params import P
from ..registry import animation
from .clip import Clip, has


@animation("walk_biped", clips=["Walk"], loop=True, params={
    "stride": P(1.0, 0.1, 3.0, doc="Tiles per cycle if the creature moved; the client divides speed by this."),
    "cadence": P(2.0, 0.5, 8.0, doc="Cycles per second at natural speed."),
    "bob": P(0.03, 0.0, 0.15),
    "swing": P(0.6, 0.1, 1.2, doc="Leg swing amplitude, radians."),
    "lean": P(0.1, 0.0, 0.6, doc="Extra forward lean while walking."),
    "arm_swing": P(0.4, 0.0, 1.2),
}, doc="""
A two-legged walk in place: legs alternate, knees fold on the forward
swing, arms counter-swing, the body bobs twice a cycle and leans into it.
""")
def walk_biped(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(1.0 / p["cadence"], fps)
    c = Clip("Walk", fps, n, loop=True, stride=p["stride"])
    A = p["swing"]
    for f in range(n):
        ph = f / n
        for leg, off in (("l", 0.0), ("r", 0.5)):
            if has(bones, f"thigh_{leg}", f"shin_{leg}"):
                c.key(f"thigh_{leg}", f, rot=(-A * loop_sin(ph + off), 0, 0))
                c.key(f"shin_{leg}", f, rot=(max(0.0, loop_cos(ph + off)) * A * 1.3, 0, 0))
            arm = "r" if leg == "l" else "l"
            if has(bones, f"upper_arm_{arm}"):
                c.key(f"upper_arm_{arm}", f, rot=(-p["arm_swing"] * loop_sin(ph + off), 0, 0))
        bob = p["bob"] * (0.5 - 0.5 * loop_cos(ph, 2.0))
        c.key("root", f, loc=(0, bob, 0), rot=(p["lean"], 0, 0.03 * loop_sin(ph)))
        if has(bones, "spine"):
            c.key("spine", f, rot=(0, 0.06 * loop_sin(ph), 0))
        if has(bones, "head"):
            c.key("head", f, rot=(0.05 * loop_sin(ph + 0.25, 2.0) - p["lean"] * 0.6, 0, 0))
        if has(bones, "tail_1"):
            c.key("tail_1", f, rot=(0, 0.2 * loop_sin(ph), 0))
    return c


@animation("scuttle", clips=["Walk"], loop=True, params={
    "stride": P(0.4, 0.05, 2.0, doc="Tiles per cycle if the creature moved."),
    "cadence": P(7.0, 1.0, 14.0, doc="Cycles per second: fast, an insect."),
    "sway": P(0.08, 0.0, 0.4, doc="Body roll, radians."),
    "lift": P(0.35, 0.0, 1.0, doc="Leg lift, radians."),
}, doc="""
An insect scuttle: legs alternate in a tripod gait (l1, l3, r2 together),
the body sways side to side and the head twitches. Fast and small.
""")
def scuttle(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(1.0 / p["cadence"], fps)
    c = Clip("Walk", fps, n, loop=True, stride=p["stride"])
    for f in range(n):
        ph = f / n
        for side in ("l", "r"):
            for i in range(1, 5):
                name = f"leg_{side}{i}"
                if not has(bones, name):
                    continue
                off = 0.0 if (i % 2 == 1) == (side == "l") else 0.5
                s = loop_sin(ph + off)
                lift = max(0.0, loop_cos(ph + off)) * p["lift"]
                sign = -1 if side == "l" else 1
                # Swing fore/aft about Y, lift about Z (outward hinge).
                c.key(name, f, rot=(0, 0.35 * s, sign * lift))
        c.key("root", f, loc=(0, 0.01 * (0.5 - 0.5 * loop_cos(ph, 2.0)), 0), rot=(0, 0, p["sway"] * loop_sin(ph)))
        if has(bones, "head"):
            c.key("head", f, rot=(0.1 * loop_sin(ph, 2.0), 0.08 * loop_sin(ph), 0))
        if has(bones, "abdomen"):
            c.key("abdomen", f, rot=(0, -0.05 * loop_sin(ph), 0))
    return c


@animation("hover_bob", clips=["Idle", "Walk"], loop=True, params={
    "amplitude": P(0.06, 0.0, 0.3, doc="Vertical bob, in tiles."),
    "duration": P(2.0, 0.5, 6.0, doc="One bob, in seconds."),
    "tilt": P(0.1, 0.0, 0.5, doc="Forward tilt while moving (Walk), radians."),
    "stride": P(1.0, 0.1, 3.0, doc="Tiles per cycle if used as Walk."),
}, doc="""
A floating bob: the root rises and falls, the bell squashes at the bottom
of the bob, the tendrils lag. As Walk it adds a forward tilt.
""")
def hover_bob(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Idle", fps, n, loop=True, stride=p["stride"])
    for f in range(n):
        ph = f / n
        y = p["amplitude"] * loop_sin(ph)
        c.key("root", f, loc=(0, y, 0), rot=(p["tilt"], 0, 0.05 * loop_sin(ph + 0.25)))
        sq = 1.0 - 0.08 * loop_sin(ph + 0.5)
        if has(bones, "bell"):
            c.key("bell", f, scale=(1 / sq ** 0.5, sq, 1 / sq ** 0.5))
        if has(bones, "tendrils"):
            c.key("tendrils", f, rot=(0.15 * loop_sin(ph - 0.15), 0, 0.1 * loop_cos(ph - 0.15)))
    return c
