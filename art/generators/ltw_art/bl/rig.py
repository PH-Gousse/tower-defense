"""
Bones → armature, and the prims' bindings → weights.

Weights were written into vertex groups by mesh.py while each prim was still
its own object, so the join carried them. What is left here is to build the
armature, parent the mesh to it, and make sure a blended prim's split runs
the right way (weight 1.0 to `bone` at the end nearest that bone's head).
"""

from __future__ import annotations

import bpy
from mathutils import Vector

from .. import frame
from ..rigs.bones import Bone


def build(bones: list[Bone], name: str) -> bpy.types.Object:
    arm = bpy.data.armatures.new(f"{name}.rig")
    ob = bpy.data.objects.new(f"{name}.rig", arm)
    bpy.context.scene.collection.objects.link(ob)
    from .scene import select_only

    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    made: dict[str, bpy.types.EditBone] = {}
    for b in bones:
        eb = arm.edit_bones.new(b.name)
        eb.head = Vector(frame.to_blender(b.head))
        eb.tail = Vector(frame.to_blender(b.tail))
        if (eb.tail - eb.head).length < 1e-4:
            eb.tail = eb.head + Vector((0, 0, 0.05))
        eb.roll = 0.0
        made[b.name] = eb
    for b in bones:
        if b.parent:
            made[b.name].parent = made[b.parent]
            made[b.name].use_connect = b.connect
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.data.display_type = "STICK"
    return ob


def bind(mesh: bpy.types.Object, arm: bpy.types.Object) -> None:
    mesh.parent = arm
    mod = mesh.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    mod.use_vertex_groups = True
    # Every bone gets a group even if empty, so a clip keying a bone that owns
    # nothing (a tail bone on a tailless variant) is harmless.
    for b in arm.data.bones:
        if b.name not in mesh.vertex_groups:
            mesh.vertex_groups.new(name=b.name)


def fix_blends(mesh: bpy.types.Object, arm: bpy.types.Object, prims) -> None:
    """mesh.py split a blended prim's weight along its axis without knowing
    which end is which. If the `bone` end of the split is farther from that
    bone's head than the `blend` end, swap the two groups' weights."""
    me = mesh.data
    groups = {g.name: g.index for g in mesh.vertex_groups}
    for p in prims:
        if p.bone is None or p.blend is None:
            continue
        if p.bone not in arm.data.bones or p.blend not in arm.data.bones:
            continue
        m = frame.prim_to_blender(p.matrix())
        axis = Vector((m[0][1], m[1][1], m[2][1])).normalized()
        origin = Vector((m[0][3], m[1][3], m[2][3]))
        head_a = arm.data.bones[p.bone].head_local
        head_b = arm.data.bones[p.blend].head_local
        ta = (head_a - origin).dot(axis)
        tb = (head_b - origin).dot(axis)
        # mesh.py gave `bone` weight 1 at the LOW end of the axis. If bone's
        # head is at the high end, flip.
        if ta <= tb:
            continue
        ga, gb = groups[p.bone], groups[p.blend]
        for v in me.vertices:
            wa = wb = None
            for g in v.groups:
                if g.group == ga:
                    wa = g
                elif g.group == gb:
                    wb = g
            if wa is not None and wb is not None and abs((wa.weight + wb.weight) - 1.0) < 1e-3:
                wa.weight, wb.weight = wb.weight, wa.weight
