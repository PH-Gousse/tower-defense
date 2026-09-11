"""
The orchestrator: a RESOLVED spec (the JSON spec-validate produces) → a glb
in assets/raw/ plus a build log. `dry_run` is the pure half: it lays the
asset out and reports what would be built, and never imports bpy.
"""

from __future__ import annotations

import json
import os
import time

from . import GENERATOR_VERSION, params as P
from .layout import Layout
from .registry import load_all
from .rng import rng_for

FPS = 24
TEXTURE_SIZE = {"creep": 512, "tower": 512, "projectile": 128, "effect": 128, "tile": 256, "prop": 256}


def lay_out(spec: dict) -> tuple[Layout, dict]:
    """Body plan + parts → one Layout, plus the per-slot palette overrides
    the parts asked for. Pure."""
    reg = load_all()
    plan_name = spec.get("body_plan", "imported")
    if plan_name == "imported":
        raise NotImplementedError("the imported body plan lands with the import path")
    plan = reg.body_plans[plan_name]
    given = dict(spec.get("params", {}))
    parts = given.pop("parts", [])
    p = P.resolve(plan.params, given, plan_name)
    rng = rng_for(spec["id"], "plan")
    lay = plan.fn(p, rng)
    overrides: dict[str, str] = {}
    for i, entry in enumerate(parts):
        name = entry if isinstance(entry, str) else entry["part"]
        at = None if isinstance(entry, str) else entry.get("at")
        scale = 1.0 if isinstance(entry, str) else float(entry.get("scale", 1.0))
        role = None if isinstance(entry, str) else entry.get("palette")
        part = reg.parts[name]
        point = lay.attachments[at or part.default_at]
        piece = part.fn(point.size, rng_for(spec["id"], f"part{i}"))
        placed = piece.placed(point.pos, point.rot, scale, bone=point.bone)
        lay.prims.extend(placed.prims)
        if role:
            for s in part.slots:
                overrides[s] = role
    from .plans.common import ground

    ground(lay)
    return lay, overrides


def plan_clips(spec: dict, bones: list[str], height: float) -> list:
    """Every clip the spec asks for, generated. Pure."""
    reg = load_all()
    clips = []
    for clip_name, a in spec.get("animations", {}).items():
        gen = reg.animations[a["gen"]]
        given = {k: v for k, v in a.items() if k not in ("gen", "markers", "stride", "duration")}
        if "duration" in a and "duration" in gen.params:
            given["duration"] = a["duration"]
        pp = P.resolve(gen.params, given, f"animations.{clip_name}")
        pp["_height"] = height
        clip = gen.fn(pp, bones, FPS, rng_for(spec["id"], clip_name))
        clip.name = clip_name
        clip.loop = gen.loop
        if "markers" in a:
            clip.markers.update(a["markers"])
        if "stride" in a:
            clip.stride = float(a["stride"])
        clips.append(clip)
    return clips


def dry_run(spec: dict) -> dict:
    reg = load_all()
    if spec.get("body_plan", "imported") == "imported":
        imp = spec.get("import", {})
        return {"id": spec["id"], "generator_version": GENERATOR_VERSION, "body_plan": "imported", "file": imp.get("file"), "clips": list(spec.get("animations", {})), "texture": TEXTURE_SIZE.get(spec["class"], 512), "note": "an import is measured after the build, not before"}
    lay, overrides = lay_out(spec)
    rig_name = spec.get("rig")
    bones = reg.rigs[rig_name].fn(lay) if rig_name else []
    clips = plan_clips(spec, [b.name for b in bones], lay.height)
    lo, hi = lay.bounds()
    return {
        "id": spec["id"],
        "generator_version": GENERATOR_VERSION,
        "body_plan": spec.get("body_plan"),
        "prims": len(lay.prims),
        "triangles_estimate": lay.triangles(),
        "height": round(lay.height, 4),
        "footprint": round(lay.footprint, 4),
        "bounds": {"min": [round(float(v), 4) for v in lo], "max": [round(float(v), 4) for v in hi]},
        "slots": lay.slots(),
        "attachments": sorted(lay.attachments),
        "bones": [b.name for b in bones],
        "clips": [{"name": c.name, "frames": c.frames, "seconds": round(c.seconds, 3), "loop": c.loop, "markers": c.markers, "stride": c.stride} for c in clips],
        "texture": TEXTURE_SIZE.get(spec["class"], 512),
        "palette_overrides": overrides,
    }


def build(spec: dict, out_glb: str, log_path: str | None = None, preview: str | None = None) -> dict:
    """Runs inside Blender."""
    import bpy

    from .bl import anim as bl_anim, export as bl_export, materials as bl_mat, mesh as bl_mesh, rig as bl_rig, scene as bl_scene

    t0 = time.time()
    reg = load_all()
    bl_scene.reset(FPS)
    name = spec["id"]
    imported = spec.get("body_plan", "imported") == "imported"
    src_arm = None
    if imported:
        from .bl import importer

        repo_root = os.path.join(os.path.dirname(__file__), "..", "..", "..")
        ob, src_arm, lay, imp_info = importer.bring_in(spec, name, repo_root)
        overrides = {}
        log: dict = {"id": name, "generator_version": GENERATOR_VERSION, "imported": imp_info, "steps": []}
    else:
        lay, overrides = lay_out(spec)
        ob = bl_mesh.realise(lay, name)
        # The layout's bounds are approximate (rotated corner boxes); the
        # mesh's are exact. Re-centre both by the exact delta so the gate's
        # origin check sees 0.000, not 0.015, and the rig lands on the mesh.
        delta = bl_mesh.recentre(ob, projectile=(spec["class"] == "projectile"))
        if any(abs(d) > 1e-6 for d in delta):
            moved = lay.placed(delta)
            lay.prims, lay.attachments, lay.joints = moved.prims, moved.attachments, moved.joints
            if lay.muzzle is not None:
                lay.muzzle = (lay.muzzle[0] + delta[0], lay.muzzle[1] + delta[1], lay.muzzle[2] + delta[2])
        log = {"id": name, "generator_version": GENERATOR_VERSION, "dry_run": dry_run(spec), "recentred": [round(d, 5) for d in delta], "steps": []}
    log["steps"].append({"mesh": {"vertices": len(ob.data.vertices), "polygons": len(ob.data.polygons)}})

    pal = spec.get("palette", {})
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    png = os.path.splitext(out_glb)[0] + ".albedo.png"
    size = TEXTURE_SIZE.get(spec["class"], 512)
    bake = bl_mat.bake_albedo(ob, pal, overrides, list(pal.get("team_mask", [])), size, lay.height, png)
    log["steps"].append({"bake": {"size": size, "png": os.path.basename(png), **{k: (v if k != "colours" else {s: [round(c, 3) for c in col] for s, col in v.items()}) for k, v in bake.items()}}})
    bl_mat.export_materials(ob, png, pal, overrides)

    rig_name = spec.get("rig")
    animated = bool(rig_name) or (imported and bool(spec.get("animations")))
    if imported and animated:
        from .bl import importer

        clip_map = spec.get("import", {}).get("clip_map", {})
        if src_arm is not None and clip_map:
            arm = src_arm
            actions = importer.rename_clips(arm, clip_map)
            log["steps"].append({"rig": {"source": True, "clips": [a.name for a in actions]}})
        else:
            arm = importer.root_only_rig(ob, name)
            clips = plan_clips(spec, ["root"], lay.height)
            actions = [bl_anim.apply_clip(arm, c) for c in clips]
            bl_anim.to_nla(arm, actions)
            log["steps"].append({"rig": {"source": False, "bones": 1, "clips": [c.name for c in clips]}})
    elif animated:
        bones = reg.rigs[rig_name].fn(lay)
        arm = bl_rig.build(bones, name)
        bl_rig.bind(ob, arm)
        bl_rig.fix_blends(ob, arm, lay.prims)
        clips = plan_clips(spec, [b.name for b in bones], lay.height)
        actions = [bl_anim.apply_clip(arm, c) for c in clips]
        bl_anim.to_nla(arm, actions)
        log["steps"].append({"rig": {"bones": len(bones), "clips": [c.name for c in clips]}})
        # The armature takes the asset's name (it is the glTF scene root the
        # client looks up); the mesh is renamed FIRST or Blender suffixes the
        # armature ".001" to dodge the collision.
        ob.name = f"{name}.mesh"
        ob.data.name = f"{name}.mesh"
        arm.name = name
        arm.data.name = name
    else:
        ob.name = name
    if lay.muzzle is not None:
        e = bpy.data.objects.new("muzzle", None)
        e.empty_display_size = 0.05
        from . import frame

        e.location = frame.to_blender(lay.muzzle)
        bpy.context.scene.collection.objects.link(e)
        e.parent = arm if animated else ob

    res = bl_export.export_glb(out_glb, animated)
    from . import glb

    glb.canonicalise(out_glb)
    if preview:
        from .bl import render as bl_render

        bl_render.solo_clip(arm if animated else None, None)
        bpy.context.scene.frame_set(0)
        bl_render.camera((0, lay.height * 0.5, 0), max(lay.height, lay.footprint * 0.8), yaw_deg=35)
        bl_render.snapshot(preview, 512, 512)
        log["steps"].append({"preview": os.path.basename(preview), "evaluated_bounds_blender": bl_render.evaluated_bounds(ob)})
    log["steps"].append({"export": {"glb": os.path.basename(out_glb), "bytes": os.path.getsize(out_glb), "unsupported_options": res["unsupported_options"]}})
    log["seconds"] = round(time.time() - t0, 2)
    if log_path:
        # Wall-clock timing stays in the console; the committed log must be
        # identical for identical output, or every rebuild dirties the tree.
        persisted = {k: v for k, v in log.items() if k != "seconds"}
        log_path_data = persisted

        with open(log_path, "w") as f:
            json.dump(log_path_data, f, indent=2)
    return log
