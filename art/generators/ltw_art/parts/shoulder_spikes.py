"""
A part is a Layout in the attachment point's local frame: origin at the
point, Y up, +Z forward, and `size` is the attachment's own scale (roughly
the local body thickness) so the same part fits a beetle and an ogre.
"""

from __future__ import annotations

import math

from ..layout import Layout, Prim
from ..registry import part


@part("shoulder_spikes", attaches=["shoulders", "shoulder_l", "shoulder_r"], default_at="shoulders", slots=["spike"], triangles=5 * 2 * 4, doc="""
A row of four spikes over each shoulder, angled outward and back. The tier-2
signature part for creeps: a silhouette change with no new body plan.
""")
def build(size: float, rng) -> Layout:
    lay = Layout()
    for side in (-1, 1):
        for i in range(4):
            t = i / 3
            r = size * (0.09 - 0.03 * t)
            h = size * (0.32 - 0.1 * t)
            x = side * size * (0.28 + 0.1 * t)
            z = size * (0.1 - 0.35 * t)
            lay.add(Prim("cone", (r, h), (x, h * 0.4, z), (0.25 * t - 0.15, 0, -side * (0.55 + 0.25 * t)), slot="spike", seg=5, name=f"spike_{side}_{i}"))
    return lay
