from __future__ import annotations

from ..layout import Layout
from ..registry import rig
from .bones import Bone, chain, root_bone


@rig("blob", plans=["blob"], bones=["root", "core", "top", "front", "back"], ik=[], doc="""
Five bones: root, a core the body hangs from, and top/front/back handles
for squash, stretch and ooze.
""")
def blob(lay: Layout) -> list[Bone]:
    j = lay.joints
    return [root_bone()] + chain(j, [
        ("core", "core", "top", "root"),
        ("top", "top", "top", "core"),
        ("front", "core", "front", "core"),
        ("back", "core", "back", "core"),
    ])


INSECT = ["root", "thorax", "head", "abdomen", "leg_l1", "leg_l2", "leg_l3", "leg_l4", "leg_r1", "leg_r2", "leg_r3", "leg_r4"]


@rig("insect", plans=["insect"], bones=INSECT, ik=[], doc="""
Twelve bones: thorax, head, abdomen and one bone per leg (four per side;
a six-legged plan leaves the fourth pair unused). Legs are single bones
because at 17 px on screen a knee is invisible.
""")
def insect(lay: Layout) -> list[Bone]:
    j = lay.joints
    bones = [root_bone()] + chain(j, [
        ("thorax", "thorax", "head", "root"),
        ("head", "head", "head_tip", "thorax"),
        ("abdomen", "abdomen", "abdomen_tip", "thorax"),
    ])
    for side in ("l", "r"):
        for i in range(1, 5):
            n = f"leg_{side}{i}"
            bones += chain(j, [(n, n, f"{n}_tip", "thorax")])
    return bones


@rig("hover", plans=["hover"], bones=["root", "body", "bell", "tendrils"], ik=[], doc="""
Four bones: root, body (the skirt), bell (the head and eyes), tendrils.
hover_bob moves the root; the bell and tendrils lag it.
""")
def hover(lay: Layout) -> list[Bone]:
    j = lay.joints
    return [root_bone()] + chain(j, [
        ("body", "body", "bell", "root"),
        ("bell", "bell", "bell_top", "body"),
        ("tendrils", "body", "tendrils_tip", "body"),
    ])


@rig("turret", plans=["turret_on_base", "cannon", "crystal_emitter", "pillar"], bones=["root", "base", "turret", "muzzle"], ik=[], doc="""
Four bones for every tower: root, base (the plinth and body), turret (the
top, which recoils, pulses or flashes), muzzle (where the projectile
leaves; the `muzzle` attachment follows it).
""")
def turret(lay: Layout) -> list[Bone]:
    j = lay.joints
    return [root_bone()] + chain(j, [
        ("base", "base", "base_top", "root"),
        ("turret", "turret", "muzzle", "base"),
        ("muzzle", "muzzle", "muzzle_tip", "turret"),
    ])
