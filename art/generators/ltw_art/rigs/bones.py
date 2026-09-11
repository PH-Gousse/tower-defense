"""
A rig template is a pure function from a Layout's joints to a list of bones
in the game frame. Blender builds the armature from it; weights are assigned
from the prims' own `bone`/`blend` bindings, which is what "tuned per plan"
means here: the plan author decided which bone owns which piece, and a
joint blend is declared, not guessed from proximity.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Bone:
    name: str
    head: tuple[float, float, float]
    tail: tuple[float, float, float]
    parent: str | None = None
    connect: bool = False


def chain(joints: dict, pairs: list[tuple[str, str, str, str | None]]) -> list[Bone]:
    """(name, head_joint, tail_joint, parent) → bones."""
    out: list[Bone] = []
    for name, h, t, parent in pairs:
        out.append(Bone(name, joints[h].pos, joints[t].pos, parent))
    return out


def root_bone(height: float = 0.12) -> Bone:
    """The root: at the origin, pointing up, the one bone every clip may
    translate (bob) and every one-shot may sink. No root motion in a loop
    is checked by the gate against this bone."""
    return Bone("root", (0.0, 0.0, 0.0), (0.0, height, 0.0), None)
