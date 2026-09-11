"""
Clip → Action, and the actions → NLA tracks the glTF exporter reads.

The conversion is the whole point of this module. A key's rotation is a
game-frame euler about the bone's head; the pose bone wants a rotation in
its own rest basis. With Rest the bone's rest matrix in armature space:

    R_local = Restᵀ · C · R_game · Cᵀ · Rest

where C is the game→Blender frame change. Translations likewise. The
generators never see a bone's local axes, and the rig can change its roll
convention without touching a clip.
"""

from __future__ import annotations

import json

import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector

from .. import frame
from ..anims.clip import Clip


def _fcurves(action: bpy.types.Action):
    """Blender 4.4+ actions are layered (layers → strips → channelbags);
    older ones expose `fcurves` directly. Walk whichever this Blender has."""
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def _rest3(arm: bpy.types.Object, name: str) -> np.ndarray:
    m = arm.data.bones[name].matrix_local
    return np.array([[m[i][j] for j in range(3)] for i in range(3)])


def apply_clip(arm: bpy.types.Object, clip: Clip) -> bpy.types.Action:
    action = bpy.data.actions.new(clip.name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    rests = {b.name: _rest3(arm, b.name) for b in arm.data.bones}
    pose = arm.pose
    for pb in pose.bones:
        pb.rotation_mode = "XYZ"
    keyed: set[str] = set()
    C = frame.C
    frames = sorted({k.frame for k in clip.keys})
    by_frame: dict[int, list] = {}
    for k in clip.keys:
        by_frame.setdefault(k.frame, []).append(k)
    last_frame = clip.frames if clip.loop else clip.frames
    for f in frames:
        for k in by_frame[f]:
            if k.bone not in rests:
                continue
            pb = pose.bones[k.bone]
            R = rests[k.bone]
            Rg = frame.compose((0, 0, 0), k.rot)[:3, :3]
            Rl = R.T @ C @ Rg @ C.T @ R
            e = Matrix(Rl.tolist()).to_euler("XYZ")
            d = R.T @ (C @ np.array(k.loc, dtype=float))
            pb.rotation_euler = e
            pb.location = Vector(d.tolist())
            pb.scale = Vector(k.scale)
            pb.keyframe_insert("rotation_euler", frame=f)
            pb.keyframe_insert("location", frame=f)
            pb.keyframe_insert("scale", frame=f)
            keyed.add(k.bone)
    if clip.loop:
        # Close the loop: frame N repeats frame 0 so the exporter's range
        # covers a whole period and the seam is exact.
        for k in by_frame.get(0, []):
            if k.bone not in rests:
                continue
            pb = pose.bones[k.bone]
            R = rests[k.bone]
            Rg = frame.compose((0, 0, 0), k.rot)[:3, :3]
            Rl = R.T @ C @ Rg @ C.T @ R
            pb.rotation_euler = Matrix(Rl.tolist()).to_euler("XYZ")
            pb.location = Vector((R.T @ (C @ np.array(k.loc, dtype=float))).tolist())
            pb.scale = Vector(k.scale)
            pb.keyframe_insert("rotation_euler", frame=clip.frames)
            pb.keyframe_insert("location", frame=clip.frames)
            pb.keyframe_insert("scale", frame=clip.frames)
    # Linear interpolation between sampled frames; the generator already
    # sampled every frame, so a bezier would only add overshoot.
    for fc in _fcurves(action):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    action.frame_range = (0, last_frame)
    action.use_frame_range = True
    action["markers"] = json.dumps(clip.markers)
    action["loop"] = clip.loop
    if clip.stride is not None:
        action["stride"] = clip.stride
    arm.animation_data.action = None
    # Rest pose between clips.
    for pb in pose.bones:
        pb.rotation_euler = Euler((0, 0, 0))
        pb.location = Vector((0, 0, 0))
        pb.scale = Vector((1, 1, 1))
    return action


def to_nla(arm: bpy.types.Object, actions: list[bpy.types.Action]) -> None:
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = None
    for a in actions:
        track = ad.nla_tracks.new()
        track.name = a.name
        strip = track.strips.new(a.name, 0, a)
        strip.name = a.name
        track.mute = False
