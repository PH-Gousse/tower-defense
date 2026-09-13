"""
    blender --background --python art/scripts/preview.py -- --batch <batch.json>

Renders previews for admitted or raw assets. A batch entry is
{id, glb, out_dir, class, clips: {name: seconds}, height, siblings: [{id, glb, label}]}.
Per asset it writes into out_dir:

  turntable.png     eight yaws at the game pitch, one strip
  silhouette.png    flat black at 32 px height (and ×8 nearest-neighbour beside it), game pitch and side
  clip_<Name>.png   six frames of each clip, one strip
  team.png          the same view tinted blue and red through the mask
  game_distance.png the asset at true on-screen size for a 1080p frame at the fitted camera distance
  lineup.png        the asset beside its siblings at true relative scale, game pitch

Loads the .glb (the thing that ships), not the spec, and swaps the
material for a toon shader that reads the team mask from the albedo alpha
-- the closest Blender gets to the client's material.
"""

import argparse
import json
import math
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "generators"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from ltw_art import frame, palette  # noqa: E402
from ltw_art.bl import render as R, scene as S  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--batch", required=True)
ap.add_argument("--result", help="write the JSON result here as well as to stdout: Blender's own render log interleaves with a long stdout line and corrupts it")
args = ap.parse_args(argv)

TEAM = {"blue": palette.linear(palette.rgb("team_blue")), "red": palette.linear(palette.rgb("team_red"))}
# The distance at which the client's default framing puts 20 rows in frame at
# fov 18, pitch 70: rows / (kn + kf) = 20 / 0.3382 (ADR-0024, style sheet §2).
# It was the fitted distance for the whole 24-row board, 71, until the lane
# became 213 rows and the camera began to scroll.
FITTED_DISTANCE = 59.1
PX_PER_UNIT_1080 = 1080 / (2 * FITTED_DISTANCE * math.tan(math.radians(R.FOV_DEG) / 2))


def load_glb(path: str) -> tuple[bpy.types.Object | None, list[bpy.types.Object]]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    # The importer parks a helper Icosphere (42 verts, 2 units across) in a
    # "glTF_not_exported" collection. It is not ours and it wrecks the bounds.
    junk = [o for o in new if any(c.name == "glTF_not_exported" for c in o.users_collection)]
    for o in junk:
        bpy.data.objects.remove(o, do_unlink=True)
    new = [o for o in new if o not in junk]
    arm = next((o for o in new if o.type == "ARMATURE"), None)
    meshes = [o for o in new if o.type == "MESH"]
    return arm, meshes


ORIGINAL: dict[tuple[str, int], bpy.types.Material] = {}


def toon_materials(meshes, team=None, flat_black=False):
    """Replace each mesh's materials: a toon ramp on the albedo, with the
    alpha channel mixing in the team colour; or plain black for silhouettes.
    Always derived from the material the glb came with -- deriving from a
    previous replacement lost the image node, and an image-less texture
    node reports alpha 1, which tinted the whole model."""
    for ob in meshes:
        for i, slot in enumerate(ob.material_slots):
            key = (ob.name, i)
            if key not in ORIGINAL and slot.material is not None:
                ORIGINAL[key] = slot.material
            src = ORIGINAL.get(key)
            if src is None:
                continue
            mat = bpy.data.materials.new(f"preview.{src.name}")
            mat.use_nodes = True
            nt = mat.node_tree
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            if flat_black:
                em = nt.nodes.new("ShaderNodeEmission")
                em.inputs["Color"].default_value = (0, 0, 0, 1)
                nt.links.new(em.outputs[0], out.inputs["Surface"])
                slot.material = mat
                continue
            img = None
            for n in src.node_tree.nodes if src.node_tree else []:
                if n.type == "TEX_IMAGE" and n.image:
                    img = n.image
            is_glow = src.name.startswith("glow")
            if is_glow:
                em = nt.nodes.new("ShaderNodeEmission")
                col = (1, 1, 1, 1)
                bsdf = src.node_tree.nodes.get("Principled BSDF") if src.node_tree else None
                if bsdf:
                    col = bsdf.inputs["Emission Color"].default_value
                em.inputs["Color"].default_value = col
                em.inputs["Strength"].default_value = 1.5
                nt.links.new(em.outputs[0], out.inputs["Surface"])
                slot.material = mat
                continue
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.interpolation = "Closest"
            if img is not None:
                tex.image = img
                img.alpha_mode = "CHANNEL_PACKED"
            colour = tex.outputs["Color"]
            if team is not None:
                mix = nt.nodes.new("ShaderNodeMix")
                mix.data_type = "RGBA"
                mix.blend_type = "MIX"
                nt.links.new(tex.outputs["Alpha"], mix.inputs["Factor"])
                nt.links.new(tex.outputs["Color"], mix.inputs[6])
                mix.inputs[7].default_value = (*TEAM[team], 1.0)
                colour = mix.outputs[2]
            diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
            nt.links.new(colour, diff.inputs["Color"])
            s2rgb = nt.nodes.new("ShaderNodeShaderToRGB")
            nt.links.new(diff.outputs[0], s2rgb.inputs[0])
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.interpolation = "CONSTANT"
            ramp.color_ramp.elements[0].position = 0.0
            ramp.color_ramp.elements[0].color = (0.55, 0.55, 0.55, 1)
            ramp.color_ramp.elements[1].position = 0.35
            ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
            nt.links.new(s2rgb.outputs["Color"], ramp.inputs["Fac"])
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            nt.links.new(colour, mul.inputs[6])
            nt.links.new(ramp.outputs["Color"], mul.inputs[7])
            em = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(mul.outputs[2], em.inputs["Color"])
            nt.links.new(em.outputs[0], out.inputs["Surface"])
            slot.material = mat


def bounds_of(meshes):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in meshes:
        ev = ob.evaluated_get(dg)
        for v in ev.data.vertices:
            w = ev.matrix_world @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def clear():
    S.reset(24)
    ORIGINAL.clear()


def render_asset(entry: dict) -> dict:
    out_dir = entry["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    written = {}
    if entry.get("lineup_only"):
        return {"lineup": render_lineup(entry["siblings"], out_dir, wide=True)}
    clear()
    arm, meshes = load_glb(entry["glb"])
    if not meshes:
        raise RuntimeError("no mesh in glb")
    R.solo_clip(arm, None)
    lo, hi = bounds_of(meshes)
    height = float(hi.z - lo.z)
    footprint = float(max(hi.x - lo.x, hi.y - lo.y))
    size = max(height, footprint * 0.9, 0.2)
    centre = (0.0, height * 0.5, 0.0)
    toon_materials(meshes, team="blue")

    # Turntable: eight yaws.
    frames = []
    for i in range(8):
        R.camera(centre, size, yaw_deg=i * 45, fill=0.85)
        p = os.path.join(out_dir, f"_tt{i}.png")
        R.snapshot(p, 256, 256)
        frames.append(p)
    written["turntable"] = frames

    # Silhouette: flat black on white, game pitch and side view.
    toon_materials(meshes, flat_black=True)
    sil = []
    for label, yaw, pitch in (("game", 35, R.PITCH_DEG), ("side", 90, 10), ("front", 0, 10)):
        R.camera(centre, size, yaw_deg=yaw, pitch_deg=pitch, fill=0.9)
        p = os.path.join(out_dir, f"_sil_{label}.png")
        R.snapshot(p, 256, 256, background=(1, 1, 1))
        sil.append(p)
    written["silhouette"] = sil

    # Team A/B.
    team = []
    for t in ("blue", "red"):
        toon_materials(meshes, team=t)
        R.camera(centre, size, yaw_deg=35, fill=0.85)
        p = os.path.join(out_dir, f"_team_{t}.png")
        R.snapshot(p, 256, 256)
        team.append(p)
    written["team"] = team

    # Clips: six frames each, at the game pitch.
    toon_materials(meshes, team="blue")
    clip_frames = {}
    if arm is not None:
        for name, seconds in entry.get("clips", {}).items():
            R.solo_clip(arm, name)
            n = max(1, int(round(seconds * 24)))
            ps = []
            for k in range(6):
                f = int(round(k * n / 5)) if n > 1 else 0
                R.camera(centre, size * 1.25, yaw_deg=35, fill=0.8)
                p = os.path.join(out_dir, f"_clip_{name}_{k}.png")
                R.snapshot(p, 200, 200, frame_no=f)
                ps.append(p)
            clip_frames[name] = ps
        R.solo_clip(arm, None)
    written["clips"] = clip_frames

    # Game distance: the asset at true size for a 1080p frame at the fitted distance.
    px = max(8, int(round(size * PX_PER_UNIT_1080 * 1.6)))
    R.camera(centre, size * 1.6, yaw_deg=0, fill=1.0)
    p = os.path.join(out_dir, "game_distance.png")
    R.snapshot(p, px, px)
    written["game_distance"] = p
    written["px_per_unit"] = PX_PER_UNIT_1080
    written["height"] = height
    written["footprint"] = footprint

    # Lineup: siblings side by side at true relative scale.
    sib = entry.get("siblings", [])
    if sib:
        written["lineup"] = render_lineup(sib, out_dir)
    return written


def render_lineup(sib: list, out_dir: str, wide: bool = False) -> dict:
    """Every model in `sib` in a row at true relative scale, from a low
    front-quarter angle so heights compare, plus the game pitch for the
    silhouettes as they will be read. Swarm-class assets are shown ×3."""
    clear()
    items = []
    x = 0.0
    tallest = 0.0
    for s in sib:
        copies = 3 if "swarm" in s["id"] else 1
        for c in range(copies):
            a, ms = load_glb(s["glb"])
            R.solo_clip(a, None)
            l2, h2 = bounds_of(ms)
            w = float(max(h2.x - l2.x, h2.y - l2.y))
            x += w / 2 + (0.05 if copies > 1 else 0.2)
            for o in ms + ([a] if a else []):
                if o.parent is None:
                    o.location.x += x
            x += w / 2 + (0.05 if copies > 1 else 0.2)
            tallest = max(tallest, float(h2.z - l2.z))
            toon_materials(ms, team="blue")
        items.append(s["id"])
    total = x
    width = 2400 if wide else 1200
    R.camera((total / 2, tallest * 0.4, 0), max(tallest * 1.1, total * (0.35 if wide else 0.6)), yaw_deg=10, pitch_deg=22, fill=0.9, aspect=width / 480)
    p = os.path.join(out_dir, "lineup.png")
    R.snapshot(p, width, 480)
    return {"png": p, "order": items}


with open(args.batch) as f:
    batch = json.load(f)
results = []
ok = True
for entry in batch:
    try:
        results.append({"id": entry["id"], "ok": True, **render_asset(entry)})
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        ok = False
        results.append({"id": entry["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})
result = {"tool": "preview.py", "ok": ok, "results": results}
if args.result:
    with open(args.result, "w") as f:
        json.dump(result, f)
print(json.dumps(result))
sys.exit(0 if ok else 1)
