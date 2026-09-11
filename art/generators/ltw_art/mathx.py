"""Small, pure, and tested: the arithmetic the generators share."""

import math

TAU = math.tau


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def smoothstep(t: float) -> float:
    t = clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def ease_out_back(t: float, overshoot: float = 0.1) -> float:
    """Rises past 1 by `overshoot` then settles. For pops and spawns."""
    t = clamp(t, 0.0, 1.0)
    s = 1.70158 * (1.0 + overshoot * 6.0)
    t -= 1.0
    return t * t * ((s + 1.0) * t + s) + 1.0


def ease_in_quad(t: float) -> float:
    t = clamp(t, 0.0, 1.0)
    return t * t


def loop_sin(phase: float, cycles: float = 1.0) -> float:
    """A sine that is exactly periodic over phase in [0, 1). Loops seamlessly
    by construction, which is what the animation contract demands of every
    loop clip."""
    return math.sin(phase * TAU * cycles)


def loop_cos(phase: float, cycles: float = 1.0) -> float:
    return math.cos(phase * TAU * cycles)


def frames_for(seconds: float, fps: int) -> int:
    """Whole frames in a clip, at least 2."""
    return max(2, int(round(seconds * fps)))


def tri_count(kind: str, seg: int, rings: int = 0) -> int:
    """Triangles a primitive costs before bevels. Used by --dry-run and by the
    layout's budget estimate, so a plan can be checked without Blender."""
    if kind == "box":
        return 12
    if kind == "cyl":
        return seg * 2 + (seg - 2) * 2  # sides + two caps as fans
    if kind == "cone":
        return seg + (seg - 2)
    if kind == "sphere":
        r = rings or max(4, seg - 2)
        return seg * (r - 2) * 2 + seg * 2
    if kind == "capsule":
        r = rings or max(4, seg - 2)
        return seg * r * 2 + seg * 2
    if kind == "octa":
        return 8
    if kind == "dodeca":
        return 36
    if kind == "torus":
        return seg * (rings or 6) * 2
    raise ValueError(kind)
