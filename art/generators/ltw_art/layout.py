"""
The data a body plan produces and Blender realises.

A Layout is a list of primitives with transforms, material slots and rig
bindings, plus named attachment points for the part library and named joints
for the rig template. It is plain data on purpose: a plan can be laid out,
counted and checked against the budget without Blender, and `--dry-run` is
just "lay it out and print it".

Everything is in the GAME frame (see frame.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

import numpy as np

from . import frame, mathx


@dataclass(frozen=True)
class Prim:
    kind: str  # box | cyl | cone | sphere | capsule | octa | dodeca | torus
    dims: tuple[float, ...]  # box: (w,h,d)  cyl: (r_top,r_bot,h)  cone: (r,h)  sphere: (r,)  capsule: (r,len)  octa: (r,)  torus: (R,r)
    pos: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rot: tuple[float, float, float] = (0.0, 0.0, 0.0)  # XYZ euler, radians
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)
    slot: str = "skin"  # material slot name; the palette maps slots to colours
    seg: int = 8
    bone: str | None = None  # dominant rig bone; None = unrigged or "nearest"
    blend: str | None = None  # a second bone to blend toward along the prim's own axis
    bevel: float = 0.0  # bevel width in units; 0 = none
    smooth: bool = False  # shade smooth (spheres, capsules); flat otherwise
    name: str = ""

    def matrix(self) -> np.ndarray:
        return frame.compose(self.pos, self.rot, self.scale)

    def triangles(self) -> int:
        return mathx.tri_count(self.kind, self.seg)


@dataclass(frozen=True)
class Attachment:
    """Where a part snaps on. `size` scales the part with the body."""

    name: str
    pos: tuple[float, float, float]
    rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    size: float = 1.0
    bone: str | None = None


@dataclass(frozen=True)
class Joint:
    """A rig landmark: the plan says where the hips, knees and head are, and
    the rig template turns those into bones."""

    name: str
    pos: tuple[float, float, float]


@dataclass
class Layout:
    prims: list[Prim] = field(default_factory=list)
    attachments: dict[str, Attachment] = field(default_factory=dict)
    joints: dict[str, Joint] = field(default_factory=dict)
    height: float = 0.0  # standing height, for the manifest and lineups
    footprint: float = 0.0  # widest extent in x/z
    muzzle: tuple[float, float, float] | None = None  # towers: where a projectile leaves

    def add(self, *prims: Prim) -> None:
        self.prims.extend(prims)

    def attach(self, a: Attachment) -> None:
        self.attachments[a.name] = a

    def joint(self, name: str, pos) -> None:
        self.joints[name] = Joint(name, tuple(float(v) for v in pos))  # type: ignore[arg-type]

    def triangles(self) -> int:
        return sum(p.triangles() for p in self.prims)

    def slots(self) -> list[str]:
        seen: list[str] = []
        for p in self.prims:
            if p.slot not in seen:
                seen.append(p.slot)
        return seen

    def bounds(self) -> tuple[np.ndarray, np.ndarray]:
        """Axis-aligned bounds from primitive corner boxes. Approximate (a
        rotated box is bounded by its rotated corners), which is what a
        budget check and a lineup need."""
        lo = np.array([np.inf] * 3)
        hi = np.array([-np.inf] * 3)
        for p in self.prims:
            hx, hy, hz = _half_extents(p)
            corners = np.array([[sx * hx, sy * hy, sz * hz, 1.0] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
            world = (p.matrix() @ corners.T).T[:, :3]
            lo = np.minimum(lo, world.min(axis=0))
            hi = np.maximum(hi, world.max(axis=0))
        return lo, hi

    def placed(self, offset, rot=(0.0, 0.0, 0.0), scale: float = 1.0, bone: str | None = None) -> "Layout":
        """A copy with every prim, attachment and joint transformed: how a
        part is snapped onto an attachment point."""
        m = frame.compose(offset, rot, (scale, scale, scale))
        out = Layout()
        for p in self.prims:
            pm = m @ p.matrix()
            pos, r, s = _decompose(pm)
            out.prims.append(replace(p, pos=pos, rot=r, scale=s, bone=p.bone or bone))
        for a in self.attachments.values():
            pos = (m @ np.array([*a.pos, 1.0]))[:3]
            out.attachments[a.name] = replace(a, pos=tuple(float(v) for v in pos), size=a.size * scale)
        for j in self.joints.values():
            pos = (m @ np.array([*j.pos, 1.0]))[:3]
            out.joints[j.name] = Joint(j.name, tuple(float(v) for v in pos))
        return out


def _half_extents(p: Prim) -> tuple[float, float, float]:
    k, d = p.kind, p.dims
    if k == "box":
        return d[0] / 2, d[1] / 2, d[2] / 2
    if k == "cyl":
        r = max(d[0], d[1])
        return r, d[2] / 2, r
    if k == "cone":
        return d[0], d[1] / 2, d[0]
    if k in ("sphere", "octa", "dodeca"):
        return d[0], d[0], d[0]
    if k == "capsule":
        return d[0], d[1] / 2 + d[0], d[0]
    if k == "torus":
        return d[0] + d[1], d[1], d[0] + d[1]
    raise ValueError(k)


def _decompose(m: np.ndarray):
    """4x4 → (pos, euler XYZ, scale), inverse of frame.compose for the
    transforms a layout produces (no shear)."""
    pos = tuple(float(v) for v in m[:3, 3])
    R = m[:3, :3].copy()
    scale = tuple(float(np.linalg.norm(R[:, i])) for i in range(3))
    for i in range(3):
        if scale[i] != 0:
            R[:, i] /= scale[i]
    # XYZ euler from R = Rz @ Ry @ Rx
    sy = -R[2, 0]
    sy = max(-1.0, min(1.0, sy))
    ry = float(np.arcsin(sy))
    if abs(abs(sy) - 1.0) > 1e-9:
        rx = float(np.arctan2(R[2, 1], R[2, 2]))
        rz = float(np.arctan2(R[1, 0], R[0, 0]))
    else:  # gimbal lock: put everything in rx
        rx = float(np.arctan2(-R[1, 2], R[1, 1]))
        rz = 0.0
    return pos, (rx, ry, rz), scale
