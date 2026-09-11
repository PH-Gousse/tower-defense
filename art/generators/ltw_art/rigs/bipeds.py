from __future__ import annotations

from ..layout import Layout
from ..registry import rig
from .bones import Bone, chain, root_bone

SMALL = ["root", "hips", "spine", "chest", "neck", "head", "tail_1", "tail_2",
         "thigh_l", "shin_l", "thigh_r", "shin_r", "upper_arm_l", "forearm_l", "upper_arm_r", "forearm_r"]

LARGE = ["root", "hips", "spine", "chest", "neck", "head",
         "thigh_l", "shin_l", "thigh_r", "shin_r",
         "upper_arm_l", "forearm_l", "hand_l", "upper_arm_r", "forearm_r", "hand_r"]


def _torso(j):
    return chain(j, [
        ("hips", "hips", "spine", "root"),
        ("spine", "spine", "chest", "hips"),
        ("chest", "chest", "neck", "spine"),
        ("neck", "neck", "head", "chest"),
        ("head", "head", "head_tip", "neck"),
    ])


def _legs(j):
    out = []
    for n in ("l", "r"):
        out += chain(j, [(f"thigh_{n}", f"hip_{n}", f"knee_{n}", "hips"), (f"shin_{n}", f"knee_{n}", f"foot_{n}", f"thigh_{n}")])
    return out


@rig("biped_small", plans=["biped_lean"], bones=SMALL, ik=[], doc="""
Sixteen bones for the lean biped: spine chain, head, a two-bone tail, two
bones per leg and two per arm. Arms have no hand bone; the forearm ends at
the hand joint.
""")
def biped_small(lay: Layout) -> list[Bone]:
    j = lay.joints
    bones = [root_bone()] + _torso(j)
    bones += chain(j, [("tail_1", "tail_base", "tail_mid", "hips"), ("tail_2", "tail_mid", "tail_tip", "tail_1")])
    bones += _legs(j)
    for n in ("l", "r"):
        bones += chain(j, [(f"upper_arm_{n}", f"shoulder_{n}", f"elbow_{n}", "chest"), (f"forearm_{n}", f"elbow_{n}", f"hand_{n}", f"upper_arm_{n}")])
    return bones


@rig("biped_large", plans=["biped_heavy"], bones=LARGE, ik=[], doc="""
Sixteen bones for the heavy biped: spine chain, head, two per leg, three
per arm (upper arm, forearm, hand) so a club can swing from the hand.
""")
def biped_large(lay: Layout) -> list[Bone]:
    j = lay.joints
    bones = [root_bone()] + _torso(j) + _legs(j)
    for n in ("l", "r"):
        bones += chain(j, [
            (f"upper_arm_{n}", f"shoulder_{n}", f"elbow_{n}", "chest"),
            (f"forearm_{n}", f"elbow_{n}", f"hand_{n}", f"upper_arm_{n}"),
            (f"hand_{n}", f"hand_{n}", f"hand_tip_{n}", f"forearm_{n}"),
        ])
    return bones
