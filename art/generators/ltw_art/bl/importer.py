"""
The `imported` body plan: an external model (.glb, .gltf, .fbx, .blend)
brought to the conventions and pushed through the same materials, mask,
clips and export as a generated asset.

What it does, in order:
  1. load the file into the empty scene
  2. join every mesh into one object; keep an armature if the file has one
  3. orient: the spec says which axis the source treats as forward and up
  4. scale: to the spec's `import.scale`, or to fit the class's height range
  5. ground and centre (base at y = 0, footprint centred)
  6. materials: every source material is mapped to a slot by name through
     `import.slot_map` (default: everything is `skin`), then the normal bake
  7. clips: if the file carries its own actions, `import.clip_map` renames
     them to the contract's names; otherwise the spec's `animations` are
     baked as root-only procedural clips onto a generated root bone

Retargeting a foreign rig onto one of the rig templates is NOT implemented
(`import.retarget` is refused with a clear error). Mapping arbitrary bone
hierarchies is a project of its own; until then, an imported creature
either brings its own clips or gets the root-only set (rise, sink, pulse,
bob), which is enough to ship a prop, a projectile or a static creature.
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Matrix, Vector

from .. import frame
from ..anims.clip import Clip
from ..layout import Layout
from ..rigs.bones import Bone

AXIS = {"+x": Vector((1, 0, 0)), "-x": Vector((-1, 0, 0)), "+y": Vector((0, 1, 0)), "-y": Vector((0, -1, 0)), "+z": Vector((0, 0, 1)), "-z": Vector((0, 0, -1))}
CLASS_HEIGHT = {"creep": 0.55, "tower": 1.2, "projectile": 0.3, "effect": 0.3, "tile": 0.02, "prop": 1.0}


def load(path: str) -> None:
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise ValueError(f"cannot import {ext!r}: .glb, .gltf, .fbx or .blend")


def bring_in(spec: dict, name: str, repo_root: str) -> tuple[bpy.types.Object, bpy.types.Object | None, Layout, dict]:
    imp = spec.get("import", {})
    path = os.path.join(repo_root, "art", "source", imp["file"]) if not os.path.isabs(imp["file"]) else imp["file"]
    if not os.path.exists(path):
        raise FileNotFoundError(f"import.file {imp['file']} not found under art/source/")
    if imp.get("retarget"):
        raise NotImplementedError("import.retarget: retargeting foreign rigs onto a template is not implemented; use clip_map for the file's own clips, or leave retarget null for procedural root-only clips")
    load(path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not meshes:
        raise ValueError("the file has no mesh")
    from .scene import select_only

    # Apply every object transform first so the join is in world space.
    select_only(*meshes)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1:
        select_only(*meshes)
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    arm = arms[0] if arms else None
    # Without a clip_map the file's own rig and clips are not wanted: drop
    # them now so they cannot leak into the export beside the procedural ones.
    if arm is not None and not imp.get("clip_map"):
        for mod in [m for m in ob.modifiers if m.type == "ARMATURE"]:
            ob.modifiers.remove(mod)
        ob.parent = None
        for a in arms:
            bpy.data.objects.remove(a, do_unlink=True)
        for a in list(bpy.data.actions):
            bpy.data.actions.remove(a)
        bpy.context.view_layer.update()
        arms = []
        arm = None
    # Orientation: rotate the source's forward/up onto the game's (+Z fwd, +Y up), in Blender terms (-Y fwd, +Z up).
    fwd = AXIS[imp.get("forward", "+z")]
    up = AXIS[imp.get("up", "+y")]
    # Source axes are given in the *game* convention labels (as a glTF would use); convert to Blender.
    fwd_bl = Vector(frame.to_blender(tuple(fwd)))
    up_bl = Vector(frame.to_blender(tuple(up)))
    target_fwd = Vector((0, -1, 0))
    target_up = Vector((0, 0, 1))
    m_src = Matrix((fwd_bl, up_bl, fwd_bl.cross(up_bl))).transposed()
    m_dst = Matrix((target_fwd, target_up, target_fwd.cross(target_up))).transposed()
    rot = m_dst @ m_src.inverted()
    objs = [ob] + ([arm] if arm else [])
    for o in objs:
        o.matrix_world = rot.to_4x4() @ o.matrix_world
    select_only(*objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Scale to fit.
    lo, hi = _bounds(ob)
    height = hi.z - lo.z
    scale = float(imp.get("scale", 0) or 0)
    if scale <= 0:
        want = float(spec.get("params", {}).get("height", CLASS_HEIGHT[spec["class"]]))
        scale = want / max(1e-6, height)
    for o in objs:
        o.matrix_world = Matrix.Scale(scale, 4) @ o.matrix_world
    select_only(*objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo, hi = _bounds(ob)
    shift = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z if spec["class"] != "projectile" else -(lo.z + hi.z) / 2))
    for o in objs:
        o.matrix_world = Matrix.Translation(shift) @ o.matrix_world
    select_only(*objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo, hi = _bounds(ob)
    lay = Layout()
    lay.height = float(hi.z - lo.z)
    lay.footprint = float(max(hi.x - lo.x, hi.y - lo.y))
    # Materials → slots.
    slot_map: dict[str, str] = dict(imp.get("slot_map", {}))
    me = ob.data
    names = [m.name if m else "" for m in me.materials]
    slots = []
    for n in names:
        slots.append(slot_map.get(n, "skin"))
    if not slots:
        slots = ["skin"]
    uniq = sorted(set(slots))
    new_mats = {s: (bpy.data.materials.get(f"slot.{s}") or bpy.data.materials.new(f"slot.{s}")) for s in uniq}
    # Append the slot materials after the source ones, remap, then pop the
    # source materials off the front. `materials.clear()` would zero every
    # polygon's index first (see materials.export_materials).
    n_src = len(me.materials)
    for s in uniq:
        me.materials.append(new_mats[s])
    index_map = [n_src + uniq.index(s) for s in slots]
    for poly in me.polygons:
        poly.material_index = index_map[poly.material_index] if poly.material_index < len(index_map) else n_src
    for _ in range(n_src):
        me.materials.pop(index=0)
    # A per-face prim id for the UV layout: one island group per source material.
    attr = me.attributes.get("prim") or me.attributes.new("prim", "INT", "FACE")
    attr.data.foreach_set("value", [poly.material_index for poly in me.polygons])
    ob.name = name
    ob.data.name = name
    info = {"source_materials": names, "slots": uniq, "scale": scale, "had_armature": arm is not None, "source_actions": [a.name for a in bpy.data.actions]}
    return ob, arm, lay, info


def _bounds(ob: bpy.types.Object) -> tuple[Vector, Vector]:
    co = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    return Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co))), Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))


def root_only_rig(ob: bpy.types.Object, name: str) -> bpy.types.Object:
    """A single root bone owning every vertex, for procedural root-only clips."""
    from . import rig as bl_rig

    arm = bl_rig.build([Bone("root", (0, 0, 0), (0, 0.12, 0), None)], name)
    g = ob.vertex_groups.new(name="root")
    g.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    bl_rig.bind(ob, arm)
    return arm


def rename_clips(arm: bpy.types.Object, clip_map: dict[str, str]) -> list[bpy.types.Action]:
    """The file's own actions, renamed to the contract's clip names and put
    on NLA tracks. Actions not in the map are dropped."""
    out = []
    for src, dst in clip_map.items():
        a = bpy.data.actions.get(src)
        if a is None:
            raise KeyError(f"import.clip_map: the file has no action {src!r}; it has {[x.name for x in bpy.data.actions]}")
        a.name = dst
        a.use_fake_user = True
        out.append(a)
    for a in list(bpy.data.actions):
        if a not in out:
            bpy.data.actions.remove(a)
    from . import anim as bl_anim

    bl_anim.to_nla(arm, out)
    return out
