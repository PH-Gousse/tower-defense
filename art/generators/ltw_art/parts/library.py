"""
The part library. Every part is a Layout in the attachment's local frame:
origin at the point, Y up, +Z forward, scaled by the attachment's `size`
(roughly the local body thickness). Slots name the palette role through
materials.SLOT_ROLES; a spec may override a part's role.
"""

from __future__ import annotations

import math

from ..layout import Layout, Prim
from ..registry import part


@part("shoulder_plates", attaches=["shoulders", "shoulder_l", "shoulder_r"], default_at="shoulders", slots=["plate"], triangles=2 * 12, doc="""
One armour plate over each shoulder, angled down and out. The tier-2 part
for heavy creeps. Plain boxes: at this size a bevel is invisible and costs
four times the triangles.
""")
def shoulder_plates(size: float, rng) -> Layout:
    lay = Layout()
    for side in (-1, 1):
        lay.add(Prim("box", (size * 0.55, size * 0.12, size * 0.65), (side * size * 0.5, size * 0.02, 0), (0, 0, -side * 0.6), slot="plate", seg=1, name=f"plate_{side}"))
    return lay


@part("back_plates", attaches=["back"], default_at="back", slots=["plate"], triangles=3 * 12, doc="""
Three overlapping plates down the spine.
""")
def back_plates(size: float, rng) -> Layout:
    lay = Layout()
    for i in range(3):
        z = (1 - i) * size * 0.45
        lay.add(Prim("box", (size * 0.7 - i * size * 0.08, size * 0.1, size * 0.5), (0, size * 0.04, z), (-0.15, 0, 0), slot="plate", seg=1, name=f"plate_{i}"))
    return lay


@part("spike_row", attaches=["back", "abdomen"], default_at="back", slots=["spike"], triangles=5 * 8, doc="""
A row of five spikes along the spine, tallest in the middle.
""")
def spike_row(size: float, rng) -> Layout:
    lay = Layout()
    for i in range(5):
        t = i / 4
        h = size * (0.25 + 0.25 * math.sin(t * math.pi))
        lay.add(Prim("cone", (size * 0.08, h), (0, h * 0.4, (0.5 - t) * size * 1.2), (0.25 - 0.5 * t, 0, 0), slot="spike", seg=5, name=f"spike_{i}"))
    return lay


@part("head_crest", attaches=["head"], default_at="head", slots=["crest"], triangles=3 * 12, doc="""
A fin-like crest on the head, three thin fins fanning back. Accent colour
and team-maskable.
""")
def head_crest(size: float, rng) -> Layout:
    lay = Layout()
    for i in range(3):
        a = (i - 1) * 0.35
        lay.add(Prim("box", (size * 0.05, size * 0.35, size * 0.45), (math.sin(a) * size * 0.12, size * 0.12, -size * 0.1), (-0.6, 0, a), slot="crest", seg=1, name=f"fin_{i}"))
    return lay


@part("horns", attaches=["head"], default_at="head", slots=["horn"], triangles=2 * 8, doc="""
Two curved-looking horns (two cones each) sweeping up and out.
""")
def horns(size: float, rng) -> Layout:
    lay = Layout()
    for side in (-1, 1):
        lay.add(Prim("cone", (size * 0.09, size * 0.45), (side * size * 0.3, size * 0.15, -size * 0.05), (0.3, 0, side * 0.7), slot="horn", seg=5, name=f"horn_{side}"))
    return lay


@part("tail_long", attaches=["tail", "hips"], default_at="tail", slots=["tail"], triangles=2 * 10, doc="""
A long tapering tail, two cones end to end, sweeping back and up.
""")
def tail_long(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cone", (size * 0.22, size * 1.4), (0, size * 0.1, -size * 0.6), (-math.pi / 2 - 0.35, 0, 0), slot="tail", seg=6, name="tail_a"))
    lay.add(Prim("cone", (size * 0.12, size * 1.0), (0, size * 0.55, -size * 1.5), (-math.pi / 2 - 0.9, 0, 0), slot="tail", seg=6, name="tail_b"))
    return lay


@part("tail_club", attaches=["tail", "hips"], default_at="tail", slots=["tail", "club"], triangles=10 + 8 + 4 * 8, doc="""
A short thick tail ending in a spiked club.
""")
def tail_club(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cone", (size * 0.25, size * 1.1), (0, 0, -size * 0.5), (-math.pi / 2 - 0.2, 0, 0), slot="tail", seg=6, name="tail"))
    lay.add(Prim("sphere", (size * 0.3,), (0, size * 0.05, -size * 1.1), slot="club", seg=8, smooth=True, name="club"))
    for k in range(4):
        a = k / 4 * math.tau
        lay.add(Prim("cone", (size * 0.07, size * 0.25), (math.cos(a) * size * 0.28, size * 0.05 + math.sin(a) * size * 0.28, -size * 1.1), (0, 0, -a + math.pi / 2), slot="club", seg=4, name=f"clubspike_{k}"))
    return lay


@part("crystal_cluster", attaches=["back", "head", "turret_top", "top"], default_at="back", slots=["crystal"], triangles=5 * 8, doc="""
Five glowing crystal shards of different heights, leaning outward. The
level-3 part for the frost shrine; a tier-3 part for creeps.
""")
def crystal_cluster(size: float, rng) -> Layout:
    lay = Layout()
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        h = size * (0.35 + 0.35 * ((k * 7) % 5) / 4)
        lay.add(Prim("octa", (size * 0.09,), (math.cos(a) * size * 0.2, h / 2, math.sin(a) * size * 0.2), (math.cos(a) * 0.3, 0, -math.sin(a) * 0.3), (1, h / (size * 0.18), 1), slot="crystal", seg=1, name=f"shard_{k}"))
    return lay


@part("crystal_shards", attaches=["back", "shoulders", "turret_top"], default_at="back", slots=["crystal"], triangles=3 * 8, doc="""
Three small crystal shards, a lighter touch than the cluster.
""")
def crystal_shards(size: float, rng) -> Layout:
    lay = Layout()
    for k in range(3):
        x = (k - 1) * size * 0.3
        h = size * (0.3 if k != 1 else 0.45)
        lay.add(Prim("octa", (size * 0.07,), (x, h / 2, 0), ((k - 1) * 0.2, 0, -(k - 1) * 0.35), (1, h / (size * 0.14), 1), slot="crystal", seg=1, name=f"shard_{k}"))
    return lay


@part("extra_barrel", attaches=["turret_top"], default_at="turret_top", slots=["barrel"], triangles=12 * 4 + 8, doc="""
A second, shorter barrel beside the first, pitched the same way. The
level-3 part for the mortar.
""")
def extra_barrel(size: float, rng) -> Layout:
    lay = Layout()
    pitch = math.radians(55)
    bl = size * 1.1
    for side in (-1, 1):
        lay.add(Prim("cyl", (size * 0.26, size * 0.3, bl), (side * size * 0.45, size * 0.3 + math.sin(pitch) * bl * 0.4, math.cos(pitch) * bl * 0.4), (pitch + math.pi / 2, 0, 0), slot="barrel", seg=10, name=f"barrel_{side}"))
        lay.add(Prim("sphere", (size * 0.32,), (side * size * 0.45, size * 0.3, 0), slot="barrel", seg=8, smooth=True, name=f"breech_{side}"))
    return lay


@part("banner", attaches=["banner", "back"], default_at="banner", slots=["pole", "banner"], triangles=12 + 12, doc="""
A pole with a hanging banner in the accent colour, team-maskable. The
tier-3 / level-3 flourish.
""")
def banner(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cyl", (size * 0.04, size * 0.04, size * 1.6), (0, size * 0.8, 0), slot="pole", seg=5, name="pole"))
    lay.add(Prim("box", (size * 0.05, size * 0.7, size * 0.45), (0, size * 1.2, size * 0.25), slot="banner", seg=1, name="cloth"))
    return lay


@part("roof_cone", attaches=["turret_top"], default_at="turret_top", slots=["roof"], triangles=8 * 2, doc="""
A conical wooden roof with a small finial. The level-2 part for the keep.
""")
def roof_cone(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cone", (size * 0.62, size * 0.8), (0, size * 0.4, 0), slot="roof", seg=8, name="roof"))
    lay.add(Prim("cone", (size * 0.2, size * 0.3), (0, size * 0.85, 0), slot="roof", seg=6, name="finial"))
    return lay


@part("spire", attaches=["turret_top"], default_at="turret_top", slots=["spire"], triangles=8 + 5, doc="""
A tall thin spire in the trim colour: gold at level 3.
""")
def spire(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cone", (size * 0.18, size * 1.3), (0, size * 0.65, 0), slot="spire", seg=6, name="spire"))
    lay.add(Prim("cyl", (size * 0.3, size * 0.3, size * 0.08), (0, size * 0.04, 0), slot="spire", seg=8, name="collar"))
    return lay


@part("gold_ring", attaches=["base_ring", "turret_top", "hips", "abdomen"], default_at="base_ring", slots=["trim"], triangles=12 * 2 + 20, doc="""
A thin ring of trim around the body: gold at level 3, otherwise a dark
band. The cheapest level-3 signal there is; on a creep it is a belt at
the hips (or round a beetle's abdomen).
""")
def gold_ring(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cyl", (size * 0.56, size * 0.56, size * 0.05), (0, size * 0.03, 0), slot="trim", seg=14, name="ring"))
    return lay


@part("emissive_trim", attaches=["base_ring", "torso_stripe", "back"], default_at="base_ring", slots=["glow"], triangles=6 * 8, doc="""
Six small glowing studs in a ring: the tier-3 emissive strip. Octahedra, not
spheres: 8 triangles each instead of 60, which is the difference between a
tier-3 creep fitting its budget and not.
""")
def emissive_trim(size: float, rng) -> Layout:
    lay = Layout()
    for k in range(6):
        a = k / 6 * math.tau
        lay.add(Prim("octa", (size * 0.07,), (math.cos(a) * size * 0.48, size * 0.03, math.sin(a) * size * 0.48), slot="glow", seg=1, name=f"stud_{k}"))
    return lay


@part("iron_bands", attaches=["base_ring"], default_at="base_ring", slots=["band"], triangles=2 * 28, doc="""
Two iron bands around the body, a little apart.
""")
def iron_bands(size: float, rng) -> Layout:
    lay = Layout()
    for y in (0.0, size * 0.25):
        lay.add(Prim("cyl", (size * 0.55, size * 0.55, size * 0.05), (0, y, 0), slot="band", seg=14, name="band"))
    return lay


@part("club", attaches=["hand_l", "hand_r"], default_at="hand_r", slots=["club"], triangles=14 + 32, doc="""
A wooden club with a knob, held in a hand, resting over the shoulder.
""")
def club(size: float, rng) -> Layout:
    lay = Layout()
    lay.add(Prim("cyl", (size * 0.09, size * 0.14, size * 1.6), (0, size * 0.7, -size * 0.3), (0.5, 0, 0.3), slot="club", seg=7, name="shaft"))
    lay.add(Prim("sphere", (size * 0.3,), (-size * 0.2, size * 1.45, -size * 0.65), slot="club", seg=6, smooth=True, name="knob"))
    return lay
