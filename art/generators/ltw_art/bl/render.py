"""
Previews rendered from inside Blender: the game camera, a toon look close to
the client's, EEVEE, a fixed sun. Used by build.py's --preview for a quick
look and by asset-preview for the turntables, contact sheets and lineups.

The camera reproduces the client's pose (fov 18, pitch 70) at a distance
chosen to frame the subject rather than the board, so a preview shows what
the asset looks like *from that angle* at a legible size; the true-scale
"game distance" strip is a separate render at the fitted distance.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector

from .. import frame

FOV_DEG = 18.0
PITCH_DEG = 70.0


BACKGROUND = (0.42, 0.5, 0.58)


def _ensure_world(colour=BACKGROUND) -> None:
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("world")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (*colour, 1.0)
        bg.inputs[1].default_value = 1.0


def _light() -> None:
    if bpy.data.objects.get("preview.sun"):
        return
    sun_d = bpy.data.lights.new("preview.sun", "SUN")
    sun_d.energy = 3.0
    sun_d.color = (1.0, 0.94, 0.85)
    sun = bpy.data.objects.new("preview.sun", sun_d)
    bpy.context.scene.collection.objects.link(sun)
    # The client's sun sits north-west and high: from -x, +y, toward +z in game terms.
    sun.rotation_euler = (math.radians(50), math.radians(-20), math.radians(-35))
    fill_d = bpy.data.lights.new("preview.fill", "SUN")
    fill_d.energy = 0.8
    fill_d.color = (0.75, 0.85, 1.0)
    fill = bpy.data.objects.new("preview.fill", fill_d)
    bpy.context.scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(-60), 0, math.radians(150))


def camera(target_game, height: float, yaw_deg: float = 0.0, pitch_deg: float = PITCH_DEG, fov_deg: float = FOV_DEG, fill: float = 0.8, aspect: float = 1.0) -> bpy.types.Object:
    """A camera looking at `target` (game frame) from the given pitch and
    yaw, far enough that `height` units fill `fill` of the frame."""
    cam_d = bpy.data.cameras.get("preview.cam") or bpy.data.cameras.new("preview.cam")
    cam_d.lens_unit = "FOV"
    cam_d.sensor_fit = "VERTICAL"
    cam_d.angle_y = math.radians(fov_deg)
    cam_d.clip_start = 0.05
    cam_d.clip_end = 500
    cam = bpy.data.objects.get("preview.cam") or bpy.data.objects.new("preview.cam", cam_d)
    if cam.name not in bpy.context.scene.collection.objects:
        bpy.context.scene.collection.objects.link(cam)
    dist = (height / fill) / (2 * math.tan(math.radians(fov_deg) / 2))
    p = math.radians(pitch_deg)
    y = math.radians(yaw_deg)
    # Game frame: the camera sits at +z (behind the model, looking toward -z)
    # for yaw 0, matching the client; yaw rotates about +y.
    off = Vector((math.sin(y) * math.cos(p), math.sin(p), math.cos(y) * math.cos(p))) * dist
    tgt = Vector(target_game)
    pos = tgt + off
    cam.location = Vector(frame.to_blender(pos))
    look = Vector(frame.to_blender(tgt)) - cam.location
    cam.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def evaluated_bounds(ob: bpy.types.Object) -> dict:
    """World-space bounds of the object as it will render (modifiers and
    pose applied). Blender frame. For logs and the gate's origin check."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    co = [ev.matrix_world @ v.co for v in ev.data.vertices]
    if not co:
        return {"min": [0, 0, 0], "max": [0, 0, 0]}
    return {"min": [round(min(c[i] for c in co), 4) for i in range(3)], "max": [round(max(c[i] for c in co), 4) for i in range(3)]}


def solo_clip(arm: bpy.types.Object | None, clip: str | None) -> None:
    """Play exactly one NLA track (or none: the rest pose). Every strip
    starts at frame 0, so with all tracks live a frame shows Death, Spawn and
    Walk stacked on each other -- which is what the first preview showed."""
    if arm is None or arm.animation_data is None:
        return
    # The glTF exporter leaves the last action it sampled assigned as the
    # active action, and an active action overrides every NLA track. Clear
    # it, or a "rest pose" render shows frame 0 of Spawn: sunk and shrunk.
    arm.animation_data.action = None
    # And the pose bones keep whatever static values the last evaluation
    # left in them, which a muted NLA does not overwrite. Back to rest.
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    for t in arm.animation_data.nla_tracks:
        t.mute = t.name != clip
        t.is_solo = False


def snapshot(path: str, width: int, height: int, frame_no: int = 0, transparent: bool = False, background=BACKGROUND) -> None:
    sc = bpy.context.scene
    _ensure_world(background)
    _light()
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = width
    sc.render.resolution_y = height
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = transparent
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    sc.view_settings.view_transform = "Standard"
    sc.frame_set(frame_no)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
