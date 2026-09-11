"""
Two coordinate frames, and the one conversion between them.

The whole pure layer works in the GAME frame: Y up, +Z forward, X to the
right, 1 unit = 1 tile, origin at the base -- exactly what the style sheet
promises the client (§8). Blender authors in Z up with -Y forward. The glTF
exporter's "+Y up" setting maps Blender -Y to glTF +Z, so converting game →
Blender here and exporting with the default settings lands the model in the
game frame with no correction anywhere.

    game (x, y, z)  →  blender (x, -z, y)

That matrix has determinant +1, so it is a rotation and handedness is kept.
"""

import numpy as np

# Column-vector convention: v_bl = C @ v_game
C = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
    ]
)
C_INV = C.T  # orthonormal

C4 = np.eye(4)
C4[:3, :3] = C
C4_INV = np.eye(4)
C4_INV[:3, :3] = C_INV


def to_blender(p) -> tuple[float, float, float]:
    x, y, z = p
    return (float(x), float(-z), float(y))


def to_game(p) -> tuple[float, float, float]:
    x, y, z = p
    return (float(x), float(z), float(-y))


def matrix_to_blender(m: np.ndarray) -> np.ndarray:
    """A 4x4 in the game frame becomes the same transform seen from Blender:
    for a matrix that maps Blender-frame local points."""
    return C4 @ m @ C4_INV


def prim_to_blender(m: np.ndarray) -> np.ndarray:
    """The matrix that takes a primitive's GAME-frame local geometry (Y up,
    as the layout builds it) to its place in Blender's frame. Not the
    conjugate: the local points are in the game frame, so only one C.

        v_bl = C · M · v_game_local

    Using the conjugate here rotated every primitive by 90° about X while
    the bones stayed put -- the first render had the hound's legs sticking
    out sideways."""
    return C4 @ m


def compose(pos=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)) -> np.ndarray:
    """Translation · rotation (XYZ euler, radians) · scale, as three.js does."""
    rx, ry, rz = rot
    cx, sx = np.cos(rx), np.sin(rx)
    cy, sy = np.cos(ry), np.sin(ry)
    cz, sz = np.cos(rz), np.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    R = Rz @ Ry @ Rx
    m = np.eye(4)
    m[:3, :3] = R @ np.diag(scale)
    m[:3, 3] = pos
    return m
