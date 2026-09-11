from __future__ import annotations

from ..layout import Layout
from ..registry import rig
from .bones import Bone, chain, root_bone

BONES = [
    "root", "hips", "spine", "chest", "neck", "head", "tail_1", "tail_2",
    "thigh_fl", "shin_fl", "thigh_fr", "shin_fr", "thigh_bl", "shin_bl", "thigh_br", "shin_br",
]


@rig(
    "quadruped",
    plans=["quadruped"],
    bones=BONES,
    ik=[],
    doc="""
Sixteen bones: root, a three-bone spine (hips, spine, chest), neck and head,
two bones per leg, a two-bone tail. Legs are FK; the walk generator plants
the feet arithmetically rather than through an IK solver, which keeps the
clip a pure function of its parameters (and IK constraints do not survive a
glTF export anyway).
""",
)
def build(lay: Layout) -> list[Bone]:
    j = lay.joints
    bones = [root_bone()]
    bones += chain(j, [
        ("hips", "hips", "spine", "root"),
        ("spine", "spine", "chest", "hips"),
        ("chest", "chest", "neck", "spine"),
        ("neck", "neck", "head", "chest"),
        ("head", "head", "head_tip", "neck"),
        ("tail_1", "tail_base", "tail_mid", "hips"),
        ("tail_2", "tail_mid", "tail_tip", "tail_1"),
    ])
    for name in ("fl", "fr", "bl", "br"):
        parent = "chest" if name.startswith("f") else "hips"
        bones += chain(j, [
            (f"thigh_{name}", f"hip_{name}", f"knee_{name}", parent),
            (f"shin_{name}", f"knee_{name}", f"foot_{name}", f"thigh_{name}"),
        ])
    return bones
