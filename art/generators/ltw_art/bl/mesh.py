"""
Layout → one mesh object.

Each primitive is built with bmesh, transformed by its game-frame matrix
(converted to Blender's frame), given a material slot, a bevel where asked,
a vertex group for its bone (and a blended second group at a joint), and
then everything is joined into one object named after the asset. The join
keeps vertex groups by name, which is how the rig finds them afterwards.
"""

from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from .. import frame
from ..layout import Layout, Prim
from ..mathx import smoothstep


def _bm_prim(bm: bmesh.types.BMesh, p: Prim) -> None:
    k, d = p.kind, p.dims
    if k == "box":
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=(d[0], d[1], d[2]), verts=bm.verts)
    elif k == "cyl":
        # Blender's cone is along local Z; the layout's is along Y (like three.js).
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=p.seg, radius1=d[1], radius2=d[0], depth=d[2])
        _z_to_y(bm)
    elif k == "cone":
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=p.seg, radius1=d[0], radius2=0.0, depth=d[1])
        _z_to_y(bm)
    elif k == "sphere":
        bmesh.ops.create_uvsphere(bm, u_segments=p.seg, v_segments=max(4, p.seg - 2), radius=d[0])
    elif k == "capsule":
        r, length = d
        bmesh.ops.create_uvsphere(bm, u_segments=p.seg, v_segments=max(4, p.seg - 2), radius=r)
        # Split at the equator and push the halves apart along Y: a capsule.
        for v in bm.verts:
            v.co.z += length / 2 if v.co.z > 1e-9 else (-length / 2 if v.co.z < -1e-9 else 0.0)
        _z_to_y(bm)
    elif k == "octa":
        bmesh.ops.create_icosphere(bm, subdivisions=0, radius=d[0])
        # An icosahedron is 20 faces; an octahedron is what the crystals want.
        bm.clear()
        r = d[0]
        vs = [bm.verts.new(v) for v in ((r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r))]
        for a, b, c in ((0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)):
            bm.faces.new((vs[a], vs[b], vs[c]))
    elif k == "dodeca":
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=d[0])
    elif k == "torus":
        R, r = d
        seg, rings = p.seg, 6
        verts = []
        for i in range(seg):
            a = i / seg * math.tau
            ring = []
            for j in range(rings):
                b = j / rings * math.tau
                x = (R + r * math.cos(b)) * math.cos(a)
                z = (R + r * math.cos(b)) * math.sin(a)
                y = r * math.sin(b)
                ring.append(bm.verts.new((x, y, z)))
            verts.append(ring)
        for i in range(seg):
            for j in range(rings):
                bm.faces.new((verts[i][j], verts[(i + 1) % seg][j], verts[(i + 1) % seg][(j + 1) % rings], verts[i][(j + 1) % rings]))
    else:
        raise ValueError(k)


def _z_to_y(bm: bmesh.types.BMesh) -> None:
    """Blender's cylinder axis is Z; the layout's is Y. Rotate so local +Z → +Y."""
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"), verts=bm.verts)


def realise(lay: Layout, name: str) -> bpy.types.Object:
    objs: list[bpy.types.Object] = []
    slots = lay.slots()
    for i, p in enumerate(lay.prims):
        bm = bmesh.new()
        _bm_prim(bm, p)
        # Layout frame → Blender frame, as one 4x4.
        m = frame.prim_to_blender(p.matrix())
        bmesh.ops.transform(bm, matrix=Matrix(m.tolist()), verts=bm.verts)
        me = bpy.data.meshes.new(f"{name}.{i:03d}")
        bm.to_mesh(me)
        bm.free()
        for s in slots:
            mat = bpy.data.materials.get(f"slot.{s}") or bpy.data.materials.new(f"slot.{s}")
            me.materials.append(mat)
        for poly in me.polygons:
            poly.material_index = slots.index(p.slot)
            poly.use_smooth = p.smooth
        # A per-face prim id that survives the join: uv.py groups islands by it.
        prim_attr = me.attributes.new("prim", "INT", "FACE")
        prim_attr.data.foreach_set("value", [i] * len(me.polygons))
        ob = bpy.data.objects.new(f"{name}.{i:03d}", me)
        ob["prim"] = p.name or f"{p.kind}_{i}"
        bpy.context.scene.collection.objects.link(ob)
        if p.bevel > 0:
            mod = ob.modifiers.new("bevel", "BEVEL")
            mod.width = p.bevel
            mod.segments = 2
            mod.limit_method = "ANGLE"
            mod.angle_limit = math.radians(40)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier="bevel")
        _bind(ob, p)
        objs.append(ob)
    from .scene import select_only

    select_only(*objs)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    # One mesh, welded where prims meet exactly (rare) and with consistent normals.
    bm = bmesh.from_edit_mesh(ob.data) if ob.mode == "EDIT" else bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    ob["layout_height"] = lay.height
    ob["layout_footprint"] = lay.footprint
    return ob


def _bind(ob: bpy.types.Object, p: Prim) -> None:
    """Vertex groups from the prim's binding. `blend` splits the weight along
    the prim's own long axis between `bone` and `blend`."""
    if p.bone is None:
        return
    me = ob.data
    g = ob.vertex_groups.new(name=p.bone)
    idx = [v.index for v in me.vertices]
    if p.blend is None:
        g.add(idx, 1.0, "REPLACE")
        return
    g2 = ob.vertex_groups.new(name=p.blend)
    # Project each vertex on the prim's local Y axis (its length axis) in
    # Blender space, and split from 1.0 at one end to 0 at the other. Which
    # end belongs to `bone` is settled in rig.py once bone heads are known;
    # here the split is stored raw and rig.py flips it if needed.
    m = frame.prim_to_blender(p.matrix())
    axis = Vector((m[0][1], m[1][1], m[2][1])).normalized()
    origin = Vector((m[0][3], m[1][3], m[2][3]))
    ts = [(v.co - origin).dot(axis) for v in me.vertices]
    lo, hi = min(ts), max(ts)
    span = max(1e-9, hi - lo)
    for v, t in zip(me.vertices, ts):
        w = smoothstep((t - lo) / span)
        g.add([v.index], 1.0 - w, "REPLACE")
        g2.add([v.index], w, "REPLACE")
    ob["blend_axis"] = list(axis)
    ob["blend_origin"] = list(origin)
    ob["blend_lo"] = lo
    ob["blend_hi"] = hi
