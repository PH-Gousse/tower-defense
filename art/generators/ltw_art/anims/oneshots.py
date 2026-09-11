"""One-shot clips: crumble, turret_recoil, pulse, build_up, upgrade_flash, sell_sink."""

from __future__ import annotations

import math

from ..mathx import ease_in_quad, ease_out_back, frames_for, smoothstep
from ..params import P
from ..registry import animation
from .clip import Clip, has


@animation("crumble", clips=["Death", "Sell"], loop=False, params={
    "duration": P(0.7, 0.3, 2.0),
    "impact": P(0.5, 0.1, 0.95, doc="When the pieces hit the ground; the `impact` marker."),
}, doc="""
The model shivers, then sinks and shrinks into the ground as if crumbling.
Root-only, so it fits any rig: a blob's death, a tower's sale.
""")
def crumble(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Death", fps, n, loop=False, markers={"impact": p["impact"]})
    height = p.get("_height", 0.5)
    for f in range(n + 1):
        t = f / n
        shiver = 0.02 * math.sin(t * 40) * (1 - t) if t < p["impact"] else 0.0
        sink = ease_in_quad(max(0.0, (t - p["impact"] * 0.5) / (1 - p["impact"] * 0.5)))
        s = 1.0 - 0.6 * sink
        c.key("root", f, loc=(shiver, -height * 0.9 * sink, 0), rot=(0.1 * sink, 0, shiver * 3), scale=(1 + 0.3 * sink, s, 1 + 0.3 * sink))
    return c


@animation("turret_recoil", clips=["Attack"], loop=False, params={
    "duration": P(0.35, 0.1, 0.6),
    "kick": P(0.08, 0.0, 0.3, doc="How far the turret drops and rocks back, in tiles."),
    "fire": P(0.1, 0.0, 0.9, doc="When the shot leaves; the `fire` marker."),
}, doc="""
A shot: the turret snaps back and down at the fire marker and eases home.
The muzzle bone flares (scales) for two frames.
""")
def turret_recoil(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Attack", fps, n, loop=False, markers={"fire": p["fire"]})
    for f in range(n + 1):
        t = f / n
        if t < p["fire"]:
            k = 0.0
        else:
            u = (t - p["fire"]) / max(1e-6, 1 - p["fire"])
            k = (1 - smoothstep(u)) * p["kick"]
        if has(bones, "turret"):
            c.key("turret", f, loc=(0, -k * 0.5, -k), rot=(-k * 2.0, 0, 0))
        if has(bones, "muzzle"):
            flare = 1.0 + (0.4 if p["fire"] <= t < p["fire"] + 2.5 / n else 0.0)
            c.key("muzzle", f, scale=(flare, flare, flare))
        c.key("root", f)
    return c


@animation("pulse", clips=["Attack", "Idle"], loop=False, params={
    "duration": P(0.4, 0.1, 4.0),
    "amount": P(0.12, 0.0, 0.5, doc="Peak scale increase."),
    "fire": P(0.3, 0.0, 0.9, doc="When the pulse peaks; the `fire` marker."),
}, doc="""
A pulse: the turret (or the whole model) swells to the fire marker and
relaxes. The frost shrine's attack, and a plain Idle for towers when used
as a loop generator elsewhere.
""")
def pulse(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Attack", fps, n, loop=False, markers={"fire": p["fire"]})
    for f in range(n + 1):
        t = f / n
        s = 1.0 + p["amount"] * math.sin(math.pi * min(1.0, t / max(1e-6, p["fire"]) * 0.5 + (0.5 * (t - p["fire"]) / max(1e-6, 1 - p["fire"]) if t > p["fire"] else 0.0)))
        target = "turret" if has(bones, "turret") else "root"
        c.key(target, f, scale=(s, s, s))
        if target != "root":
            c.key("root", f)
    return c


@animation("build_up", clips=["Build"], loop=False, params={
    "duration": P(0.8, 0.3, 2.0),
    "overshoot": P(0.1, 0.0, 0.4),
}, doc="""
A tower is built: it rises from the ground in two stages -- the base first,
then the turret pops up with a small overshoot -- and ends at rest.
""")
def build_up(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Build", fps, n, loop=False)
    height = p.get("_height", 1.0)
    for f in range(n + 1):
        t = f / n
        base_t = smoothstep(t / 0.55)
        c.key("root", f, loc=(0, -height * (1 - base_t), 0))
        if has(bones, "turret"):
            tt = max(0.0, (t - 0.4) / 0.6)
            s = 0.2 + 0.8 * ease_out_back(tt, p["overshoot"])
            c.key("turret", f, scale=(s, s, s))
    return c


@animation("upgrade_flash", clips=["Upgrade"], loop=False, params={
    "duration": P(0.5, 0.2, 1.5),
    "overshoot": P(0.1, 0.0, 0.4),
}, doc="""
An upgrade lands: the whole model squashes and pops to full size with an
overshoot, then rests. Plays on the NEW level's model.
""")
def upgrade_flash(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Upgrade", fps, n, loop=False)
    for f in range(n + 1):
        t = f / n
        s = 0.8 + 0.2 * ease_out_back(t, p["overshoot"])
        sy = 2.0 - s if t < 0.25 else s
        c.key("root", f, scale=(s, sy, s))
    return c


@animation("sell_sink", clips=["Sell"], loop=False, params={
    "duration": P(0.6, 0.2, 1.5),
}, doc="""
A tower is sold: it sinks into the ground, spinning a little, and ends
below the turf at zero scale.
""")
def sell_sink(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Sell", fps, n, loop=False)
    height = p.get("_height", 1.0)
    for f in range(n + 1):
        t = f / n
        u = ease_in_quad(t)
        s = max(0.01, 1.0 - u)
        c.key("root", f, loc=(0, -height * u, 0), rot=(0, 1.2 * u, 0), scale=(s, s, s))
    return c
