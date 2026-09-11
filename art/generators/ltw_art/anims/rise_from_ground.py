from __future__ import annotations

from ..mathx import ease_out_back, frames_for, smoothstep
from ..params import P
from ..registry import animation
from .clip import Clip

PARAMS = {
    "duration": P(0.6, 0.2, 2.0),
    "overshoot": P(0.08, 0.0, 0.3, doc="How far past full size the pop goes before settling."),
    "depth": P(1.0, 0.2, 2.0, doc="Start depth below ground, as a fraction of the model's own height."),
    "land": P(0.7, 0.0, 1.0, doc="Normalised time the feet touch down; the `land` marker."),
}


@animation("rise_from_ground", clips=["Spawn", "Build"], loop=False, params=PARAMS, doc="""
The model rises out of the ground and pops to full size with a small
overshoot. Root-only, so it works on every rig. The final frame is the rest
pose, so the client can crossfade into Idle or Walk with no jump. `depth` is
a fraction of the height and is resolved by the builder, which knows it.
""")
def build(p: dict, bones: list[str], fps: int, rng) -> Clip:
    n = frames_for(p["duration"], fps)
    c = Clip("Spawn", fps, n, loop=False, markers={"land": p["land"]})
    height = p.get("_height", 1.0)
    for f in range(n + 1):
        t = f / n
        up = smoothstep(t / 0.85) if t < 0.85 else 1.0
        y = -height * p["depth"] * (1 - up)
        s = 0.6 + 0.4 * ease_out_back(t, p["overshoot"])
        c.key("root", f, loc=(0, y, 0), scale=(s, s, s))
    return c
