"""Helpers every plan uses: limbs, heads, and the base-at-origin promise."""

from __future__ import annotations

import math

from ..layout import Layout, Prim

HALF_PI = math.pi / 2


def leg(lay: Layout, name: str, top, knee, foot, r_top: float, r_bot: float, slot: str, seg: int = 7, bevel: float = 0.0) -> None:
    """A two-segment leg: thigh from `top` to `knee`, shin from `knee` to
    `foot`, as two cylinders each bound to its own bone (`thigh_<name>`,
    `shin_<name>`). Joints are recorded so the rig can find them."""
    for seg_name, a, b, ra, rb in (("thigh", top, knee, r_top, (r_top + r_bot) / 2), ("shin", knee, foot, (r_top + r_bot) / 2, r_bot)):
        lay.add(_segment(a, b, ra, rb, slot, seg, f"{seg_name}_{name}", bevel))
    lay.joint(f"hip_{name}", top)
    lay.joint(f"knee_{name}", knee)
    lay.joint(f"foot_{name}", foot)


def _segment(a, b, ra: float, rb: float, slot: str, seg: int, bone: str, bevel: float) -> Prim:
    """A cylinder from a to b (cylinder axis is local Y)."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    length = math.sqrt(dx * dx + dy * dy + dz * dz)
    mid = ((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    # Rotate local +Y onto the a→b direction: pitch about X by the angle from
    # +Y toward +Z, then yaw about Y for the x component.
    rx = math.atan2(dz, dy) if abs(dz) + abs(dy) > 1e-9 else 0.0
    horiz = math.sqrt(dz * dz + dy * dy)
    rz = -math.atan2(dx, horiz)
    # Cylinder along local Y with the TOP radius at +Y: a runs to +Y? No: the
    # rotation maps +Y to a→b, so +Y end is b. Top radius is therefore rb.
    return Prim("cyl", (rb, ra, length), mid, (rx, 0.0, rz), (1, 1, 1), slot, seg, bone=bone, bevel=bevel)


def eyes(lay: Layout, pos, spacing: float, r: float, bone: str, forward: float = 0.0) -> None:
    """Two glowing spheres in the `eyes` slot, always the glow material."""
    x, y, z = pos
    for side in (-1, 1):
        lay.add(Prim("sphere", (r,), (x + side * spacing, y, z + forward), slot="eyes", seg=5, bone=bone, smooth=True))


def ground(lay: Layout) -> None:
    """Every plan ends with this: the lowest point sits exactly on y = 0 and
    the footprint is centred, which is the style sheet's origin rule."""
    lo, hi = lay.bounds()
    dy = -float(lo[1])
    cx = float((lo[0] + hi[0]) / 2)
    cz = float((lo[2] + hi[2]) / 2)
    if abs(dy) < 1e-9 and abs(cx) < 1e-9 and abs(cz) < 1e-9:
        lay.height = float(hi[1] - lo[1])
        lay.footprint = float(max(hi[0] - lo[0], hi[2] - lo[2]))
        return
    moved = lay.placed((-cx, dy, -cz))
    lay.prims = moved.prims
    lay.attachments = moved.attachments
    lay.joints = moved.joints
    if lay.muzzle is not None:
        lay.muzzle = (lay.muzzle[0] - cx, lay.muzzle[1] + dy, lay.muzzle[2] - cz)
    lay.height = float(hi[1] - lo[1])
    lay.footprint = float(max(hi[0] - lo[0], hi[2] - lo[2]))
