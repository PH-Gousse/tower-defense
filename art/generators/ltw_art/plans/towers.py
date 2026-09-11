"""
Tower body plans. Every tower stands on a 0.84 × 0.84 plinth inside its
1 × 1 tile, has a `muzzle` (where the projectile leaves), and rigs to the
four-bone `turret` template: root, base, turret, muzzle. Levels are the
tier language applied by the spec (size, parts, palette, trim), not new
plans -- the same plan with `roof: cone` and a `spire` part IS level 3.
"""

from __future__ import annotations

import math

from ..layout import Attachment, Layout, Prim
from ..params import P, SEED
from ..registry import body_plan
from .common import ground

PLINTH = 0.84


def _plinth(lay: Layout, size: float) -> float:
    lay.add(Prim("box", (size, 0.14, size), (0, 0.07, 0), slot="base", seg=1, bone="base", bevel=0.015, name="plinth"))
    lay.add(Prim("box", (size * 0.83, 0.1, size * 0.83), (0, 0.19, 0), slot="base", seg=1, bone="base", bevel=0.01, name="step"))
    return 0.24


def _turret_joints(lay: Layout, base_top: float, turret_y: float, muzzle) -> None:
    lay.joint("base", (0, 0, 0))
    lay.joint("base_top", (0, base_top, 0))
    lay.joint("turret", (0, turret_y, 0))
    lay.joint("muzzle", muzzle)
    lay.joint("muzzle_tip", (muzzle[0], muzzle[1] + 0.05, muzzle[2]))
    lay.muzzle = muzzle


@body_plan("turret_on_base", "tower", {
    "height": P(1.2, 0.8, 2.0, doc="Plinth to parapet."),
    "base_size": P(PLINTH, 0.5, PLINTH),
    "keep_radius": P(0.27, 0.15, 0.4),
    "merlons": P(6, 0, 10, doc="Blocks around the parapet."),
    "roof": P("none", enum=("none", "cone", "spire"), doc="What sits on top."),
    "seed": SEED,
}, attachments=["turret_top", "muzzle", "base_ring", "banner"], slots=["base", "keep", "parapet", "roof", "trim", "banner", "slit"], doc="""
turret_on_base -- the guard tower: a tapering round keep on a square plinth
with a crenellated parapet. Tall and thin, as the single-target silhouette
rule asks: height is at least 2.5 × the keep's width.
""")
def turret_on_base(p: dict, rng) -> Layout:
    lay = Layout()
    top0 = _plinth(lay, p["base_size"])
    h, r = p["height"], p["keep_radius"]
    lay.add(Prim("cyl", (r * 0.85, r, h), (0, top0 + h / 2, 0), slot="keep", seg=12, bone="base", blend="turret", name="keep"))
    top = top0 + h
    lay.add(Prim("cyl", (r * 1.2, r * 1.0, 0.12), (0, top + 0.06, 0), slot="trim", seg=12, bone="turret", name="parapet_ring"))
    n = int(p["merlons"])
    for k in range(n):
        a = k / n * math.tau
        lay.add(Prim("box", (0.1, 0.12, 0.1), (math.cos(a) * r * 0.95, top + 0.18, math.sin(a) * r * 0.95), (0, -a, 0), slot="parapet", seg=1, bone="turret", name=f"merlon_{k}"))
    for k in range(4):
        a = k / 4 * math.tau + math.pi / 4
        lay.add(Prim("box", (0.05, 0.22, 0.03), (math.cos(a) * r * 0.93, top0 + h * 0.6, math.sin(a) * r * 0.93), (0, -a + math.pi / 2, 0), slot="slit", seg=1, bone="base", name=f"slit_{k}"))
    roof_top = top + 0.24
    if p["roof"] == "cone":
        lay.add(Prim("cone", (r * 1.1, 0.42), (0, top + 0.24 + 0.21, 0), slot="roof", seg=8, bone="turret", name="roof"))
        roof_top = top + 0.66
    elif p["roof"] == "spire":
        lay.add(Prim("cone", (r * 0.6, 0.45), (0, top + 0.24 + 0.225, 0), slot="roof", seg=8, bone="turret", name="spire"))
        roof_top = top + 0.69
    lay.add(Prim("cyl", (r * 1.0, r * 1.02, 0.18), (0, top0 + h * 0.6, 0), slot="banner", seg=12, bone="base", name="team_band"))
    muzzle = (0.0, top + 0.3, 0.0)
    _turret_joints(lay, top0, top, muzzle)
    lay.attach(Attachment("turret_top", (0, roof_top, 0), size=r * 2, bone="turret"))
    lay.attach(Attachment("muzzle", muzzle, size=r, bone="muzzle"))
    lay.attach(Attachment("base_ring", (0, top0 + 0.02, 0), size=r * 2.2, bone="base"))
    lay.attach(Attachment("banner", (0, top + 0.1, r * 1.1), size=0.5, bone="turret"))
    ground(lay)
    return lay


@body_plan("cannon", "tower", {
    "height": P(0.9, 0.5, 1.4, doc="Plinth to the top of the drum."),
    "base_size": P(PLINTH, 0.5, PLINTH),
    "drum_radius": P(0.34, 0.2, 0.42),
    "barrels": P(1, 1, 3),
    "barrel_length": P(0.42, 0.2, 0.8),
    "pitch_deg": P(55, 20, 80, doc="Barrel elevation."),
    "seed": SEED,
}, attachments=["turret_top", "muzzle", "base_ring", "banner"], slots=["base", "drum", "bands", "barrel", "trim", "banner", "shot"], doc="""
cannon -- the mortar: a squat stone drum with a bronze barrel pitched at the
sky, iron bands, a pile of shot beside it. Squat on purpose: height is at
most 1.2 × width, so the thing that hits an area looks like it lobs.
""")
def cannon(p: dict, rng) -> Layout:
    lay = Layout()
    top0 = _plinth(lay, p["base_size"])
    r = p["drum_radius"]
    drum_h = max(0.2, p["height"] - top0 - 0.2)
    lay.add(Prim("cyl", (r, r + 0.04, drum_h), (0, top0 + drum_h / 2, 0), slot="drum", seg=14, bone="base", name="drum"))
    for frac in (0.3, 0.8):
        lay.add(Prim("cyl", (r + 0.05, r + 0.05, 0.05), (0, top0 + drum_h * frac, 0), slot="bands", seg=14, bone="base", name="band"))
    top = top0 + drum_h
    lay.add(Prim("cyl", (r - 0.06, r - 0.06, 0.06), (0, top + 0.03, 0), slot="base", seg=14, bone="turret", name="lid"))
    pitch = math.radians(p["pitch_deg"])
    n = int(p["barrels"])
    bl = p["barrel_length"]
    br = 0.11
    muzzle = (0.0, 0.0, 0.0)
    for b in range(n):
        side = 0.0 if n == 1 else (b - (n - 1) / 2) * 0.16
        cy = top + 0.14
        # Barrel points up-lane (+z, toward the entrance) and up.
        lay.add(Prim("cyl", (br * 0.85, br, bl), (side, cy + math.sin(pitch) * bl * 0.4, math.cos(pitch) * bl * 0.4), (pitch - math.pi / 2 + math.pi, 0, 0), slot="barrel", seg=12, bone="turret", blend="muzzle", name=f"barrel_{b}"))
        lay.add(Prim("cyl", (br + 0.02, br + 0.02, 0.05), (side, cy + math.sin(pitch) * bl * 0.55, math.cos(pitch) * bl * 0.55), (pitch - math.pi / 2, 0, 0), slot="bands", seg=12, bone="muzzle", name=f"ring_{b}"))
        lay.add(Prim("sphere", (br * 1.15,), (side, cy, 0.0), slot="bands", seg=8, bone="turret", smooth=True, name=f"breech_{b}"))
        if b == 0:
            muzzle = (side, cy + math.sin(pitch) * bl * 0.85, math.cos(pitch) * bl * 0.85)
    for (x, z, y) in ((-0.3, -0.3, 0.07), (-0.3, -0.18, 0.07), (-0.24, -0.24, 0.18)):
        lay.add(Prim("sphere", (0.07,), (x, top0 + y, z), slot="shot", seg=8, bone="base", smooth=True, name="shot"))
    lay.add(Prim("cyl", (r + 0.055, r + 0.055, 0.14), (0, top0 + drum_h * 0.62, 0), slot="banner", seg=14, bone="base", name="team_band"))
    _turret_joints(lay, top0, top, muzzle)
    lay.attach(Attachment("turret_top", (0, top + 0.08, -r * 0.4), size=r, bone="turret"))
    lay.attach(Attachment("muzzle", muzzle, rot=(pitch - math.pi / 2, 0, 0), size=br * 2, bone="muzzle"))
    lay.attach(Attachment("base_ring", (0, top0 + drum_h * 0.18, 0), size=r * 1.9, bone="base"))
    lay.attach(Attachment("banner", (0, top0 + drum_h * 0.6, -(r + 0.05)), size=0.4, bone="base"))
    ground(lay)
    return lay


@body_plan("crystal_emitter", "tower", {
    "height": P(1.1, 0.6, 1.8, doc="Plinth to the tip of the main crystal."),
    "base_size": P(PLINTH, 0.5, PLINTH),
    "crystal_height": P(0.55, 0.2, 1.2),
    "ring_crystals": P(2, 0, 8),
    "seed": SEED,
}, attachments=["turret_top", "muzzle", "base_ring", "banner"], slots=["base", "pedestal", "crystal", "ring", "trim", "banner", "snow"], doc="""
crystal_emitter -- the frost shrine: a blue-grey pedestal with a cluster of
glowing crystals. The crystals are the visible emitter the slow tower's
silhouette rule demands, and they are the glow material so they read from
any angle.
""")
def crystal_emitter(p: dict, rng) -> Layout:
    lay = Layout()
    top0 = _plinth(lay, p["base_size"])
    ped_h = 0.3
    lay.add(Prim("cyl", (0.26, 0.32, ped_h), (0, top0 + ped_h / 2, 0), slot="pedestal", seg=8, bone="base", name="pedestal"))
    lay.add(Prim("cyl", (0.3, 0.26, 0.05), (0, top0 + ped_h + 0.025, 0), slot="ring", seg=8, bone="turret", name="collar"))
    for sx, sz in ((-1, -1), (1, -1), (-1, 1), (1, 1)):
        lay.add(Prim("sphere", (0.1,), (sx * 0.3, top0, sz * 0.3), scale=(1, 0.4, 1), slot="snow", seg=8, bone="base", smooth=True, name="snow"))
    top = top0 + ped_h + 0.08
    ch = p["crystal_height"]
    lay.add(Prim("octa", (0.16,), (0, top + ch / 2, 0), scale=(1, ch / 0.32, 1), slot="crystal", seg=1, bone="turret", blend="muzzle", name="crystal"))
    n = int(p["ring_crystals"])
    for k in range(n):
        a = k / max(1, n) * math.tau + 0.4
        h = ch * 0.5
        lay.add(Prim("octa", (0.09,), (math.cos(a) * 0.2, top + h / 2, math.sin(a) * 0.2), (math.cos(a) * 0.35, 0, -math.sin(a) * 0.35), (1, h / 0.18, 1), slot="crystal", seg=1, bone="turret", name=f"shard_{k}"))
    lay.add(Prim("box", (0.1, 0.12, 0.03), (0, top0 + ped_h * 0.5, -0.33), slot="banner", seg=1, bone="base", name="banner_patch"))
    muzzle = (0.0, top + ch, 0.0)
    _turret_joints(lay, top0, top, muzzle)
    lay.attach(Attachment("turret_top", (0, top + ch * 0.3, 0), size=0.4, bone="turret"))
    lay.attach(Attachment("muzzle", muzzle, size=0.2, bone="muzzle"))
    lay.attach(Attachment("base_ring", (0, top0 + ped_h * 0.5, 0), size=0.7, bone="base"))
    lay.attach(Attachment("banner", (0, top0 + ped_h * 0.6, -0.34), size=0.4, bone="base"))
    ground(lay)
    return lay


@body_plan("pillar", "tower", {
    "height": P(1.4, 0.8, 2.2, doc="Plinth to capital."),
    "base_size": P(PLINTH, 0.5, PLINTH),
    "shaft_radius": P(0.2, 0.1, 0.35),
    "flutes": P(0, 0, 12, doc="Vertical grooves; 0 for a plain shaft."),
    "seed": SEED,
}, attachments=["turret_top", "muzzle", "base_ring", "banner"], slots=["base", "shaft", "capital", "trim", "banner"], doc="""
pillar -- a plain column with a capital: the neutral tower body for anything
that is not a keep, a mortar or a shrine. What sits on top comes from the
part library (a crystal cluster, a banner, an emissive ring).
""")
def pillar(p: dict, rng) -> Layout:
    lay = Layout()
    top0 = _plinth(lay, p["base_size"])
    h, r = p["height"], p["shaft_radius"]
    lay.add(Prim("cyl", (r * 0.9, r, h), (0, top0 + h / 2, 0), slot="shaft", seg=10, bone="base", blend="turret", name="shaft"))
    n = int(p["flutes"])
    for k in range(n):
        a = k / n * math.tau
        lay.add(Prim("box", (0.03, h * 0.8, 0.03), (math.cos(a) * r * 0.95, top0 + h / 2, math.sin(a) * r * 0.95), (0, -a, 0), slot="base", seg=1, bone="base", blend="turret", name=f"flute_{k}"))
    top = top0 + h
    lay.add(Prim("box", (r * 2.6, 0.1, r * 2.6), (0, top + 0.05, 0), slot="capital", seg=1, bone="turret", bevel=0.01, name="capital"))
    lay.add(Prim("box", (0.1, 0.14, 0.03), (0, top0 + h * 0.5, -(r + 0.015)), slot="banner", seg=1, bone="base", name="banner_patch"))
    muzzle = (0.0, top + 0.2, 0.0)
    _turret_joints(lay, top0, top, muzzle)
    lay.attach(Attachment("turret_top", (0, top + 0.1, 0), size=r * 2.4, bone="turret"))
    lay.attach(Attachment("muzzle", muzzle, size=r, bone="muzzle"))
    lay.attach(Attachment("base_ring", (0, top0 + 0.05, 0), size=r * 2.2, bone="base"))
    lay.attach(Attachment("banner", (0, top0 + h * 0.5, -(r + 0.02)), size=0.4, bone="base"))
    ground(lay)
    return lay
