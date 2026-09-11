"""
The material system.

Every material slot the layout uses maps to a palette colour through a role
(primary, secondary, accent, glow, trim) or a fixed colour (tusks are bone,
spikes are iron), with the spec's palette deciding what the roles mean and
the tier shift blending primary toward accent. All of that is baked into ONE
512² albedo texture: flat colour × a vertical gradient × ambient occlusion,
with the team-colour mask in the alpha channel. The exported glTF has two
materials, `body` (the texture) and `glow` (unlit emissive colour), so an
asset is one texture and at most two draw calls.

Baking is a Cycles EMIT bake of a node tree that computes the colour, so
there is no light to sample and the result has no noise; AO is the one
sampled term, taken at a fixed seed on the CPU so two builds agree.
"""

from __future__ import annotations

import os

import bpy
import numpy as np

from .. import palette

# Debugging knobs, not settings: bisecting a determinism problem means
# turning the sampled term off without editing code.
BAKE_SAMPLES = int(os.environ.get("LTW_BAKE_SAMPLES", "16"))
BAKE_MARGIN = int(os.environ.get("LTW_BAKE_MARGIN", "4"))
AO_STRENGTH = float(os.environ.get("LTW_AO", "0.55"))

# Slot → role or fixed palette colour. A part may override the role for its
# own slots through the spec (`palette:` on the part entry).
SLOT_ROLES: dict[str, str] = {
    # primaries
    "skin": "primary", "shell": "primary", "base": "secondary", "keep": "primary", "drum": "primary",
    "pedestal": "primary", "shaft": "primary", "body": "primary", "face": "primary", "core": "glow",
    # secondaries
    "belly": "secondary", "limbs": "secondary", "cloth": "secondary", "legs": "secondary", "bands": "iron",
    "parapet": "secondary", "ring": "secondary", "capital": "secondary", "snout": "secondary", "plate": "secondary",
    "roof": "wood_dark", "pole": "wood_dark", "club": "wood_dark", "barrel": "bronze", "band": "iron",
    # accents (team-maskable)
    "torso_stripe": "accent", "head_crest": "accent", "banner": "accent", "crest": "accent", "tendrils": "accent",
    "spike": "iron", "horn": "bone", "tusk": "bone", "bone": "bone", "tail": "primary", "fletching": "bone",
    "head": "iron",
    # glow
    "eyes": "glow", "crystal": "glow", "glow": "glow", "halo": "glow", "rune": "glow",
    # trim
    "trim": "trim", "spire": "trim",
}

GLOW_SLOTS = {"eyes", "crystal", "glow", "halo", "rune", "core"}


def slot_colour(slot: str, pal: dict, overrides: dict[str, str]) -> tuple[float, float, float]:
    role = overrides.get(slot, SLOT_ROLES.get(slot, "secondary"))
    shift = float(pal.get("tier_shift", 0.0))
    if role == "primary":
        return palette.mix(pal["primary"], pal["accent"], shift)
    if role == "secondary":
        return palette.mix(pal["secondary"], pal["accent"], shift * 0.5)
    if role == "accent":
        return palette.rgb(pal["accent"])
    if role == "glow":
        return palette.rgb(pal.get("glow") or pal["accent"])
    if role == "trim":
        return palette.rgb("gold") if pal.get("trim") else palette.mix(pal["secondary"], pal["accent"], shift * 0.5)
    return palette.rgb(role)  # a fixed palette colour


def _emit_tree(mat: bpy.types.Material, colour, gradient: float, ao_strength: float, mask: float) -> None:
    """Emission = colour × (1 − gradient + gradient × height01) × AO, or, for
    the mask pass, plain white/black. `mask` < 0 means the colour pass."""
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    if mask >= 0:
        emit.inputs["Color"].default_value = (mask, mask, mask, 1.0)
        return
    rgb = nt.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = (*palette.linear(colour), 1.0)
    # Height gradient: object-space Z (up, in Blender) mapped over the object's height.
    tex = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex.outputs["Object"], sep.inputs[0])
    rng = nt.nodes.new("ShaderNodeMapRange")
    rng.inputs["From Min"].default_value = 0.0
    rng.inputs["From Max"].default_value = max(1e-3, mat.get("height", 1.0))
    rng.inputs["To Min"].default_value = 1.0 - gradient
    rng.inputs["To Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], rng.inputs["Value"])
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 8
    ao.inputs["Distance"].default_value = 0.35
    ao.only_local = True
    mixao = nt.nodes.new("ShaderNodeMix")
    mixao.data_type = "FLOAT"
    mixao.inputs["Factor"].default_value = ao_strength
    mixao.inputs[2].default_value = 1.0  # A
    nt.links.new(ao.outputs["AO"], mixao.inputs[3])  # B
    mul1 = nt.nodes.new("ShaderNodeVectorMath")
    mul1.operation = "SCALE"
    nt.links.new(rgb.outputs[0], mul1.inputs[0])
    nt.links.new(rng.outputs[0], mul1.inputs["Scale"])
    mul2 = nt.nodes.new("ShaderNodeVectorMath")
    mul2.operation = "SCALE"
    nt.links.new(mul1.outputs[0], mul2.inputs[0])
    nt.links.new(mixao.outputs[0], mul2.inputs["Scale"])
    nt.links.new(mul2.outputs[0], emit.inputs["Color"])


def unwrap(ob: bpy.types.Object, size: int) -> dict:
    from .uv import layout_uvs

    return layout_uvs(ob, size)


def _bake(ob: bpy.types.Object, image: bpy.types.Image, samples: int) -> None:
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.seed = 0
    sc.cycles.use_denoising = False
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.margin = BAKE_MARGIN
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_clear = True
    for mat in ob.data.materials:
        nt = mat.node_tree
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = image
        nt.nodes.active = node
    from .scene import select_only

    select_only(ob)
    bpy.ops.object.bake(type="EMIT", margin=BAKE_MARGIN, use_clear=True)
    for mat in ob.data.materials:
        for n in [n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"]:
            mat.node_tree.nodes.remove(n)


def bake_albedo(ob: bpy.types.Object, pal: dict, overrides: dict[str, str], team_slots: list[str], size: int, height: float, out_png: str, gradient: float = 0.18, ao_strength: float = AO_STRENGTH) -> dict:
    """Two EMIT bakes (colour, mask) composed into one RGBA PNG. Returns the
    slot → colour table for the build log."""
    colours: dict[str, tuple[float, float, float]] = {}
    for mat in ob.data.materials:
        slot = mat.name.split(".", 1)[1]
        mat["height"] = height
        colours[slot] = slot_colour(slot, pal, overrides)
        _emit_tree(mat, colours[slot], gradient, ao_strength, -1.0)
    uv_info = unwrap(ob, size)
    img = bpy.data.images.new("bake", size, size, alpha=True, float_buffer=False)
    img.colorspace_settings.name = "sRGB"
    _bake(ob, img, samples=BAKE_SAMPLES if ao_strength > 0 else 1)
    rgb = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(rgb)
    rgb = rgb.reshape(size, size, 4)
    for mat in ob.data.materials:
        slot = mat.name.split(".", 1)[1]
        _emit_tree(mat, (0, 0, 0), 0, 0, 1.0 if slot in team_slots else 0.0)
    _bake(ob, img, samples=1)
    mask = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(mask)
    mask = mask.reshape(size, size, 4)
    rgba = rgb.copy()
    rgba[..., 3] = mask[..., 0]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = out_png
    img.file_format = "PNG"
    img.save()
    # Now the export materials: body (textured) and glow (emissive colour).
    return {"colours": colours, "mask_coverage": float(mask[..., 0].mean()), **uv_info}


def export_materials(ob: bpy.types.Object, png_path: str, pal: dict, overrides: dict[str, str]) -> None:
    """Replace the per-slot bake materials with the two the glTF carries."""
    img = bpy.data.images.load(png_path)
    img.name = ob.name
    img.colorspace_settings.name = "sRGB"
    # The alpha channel is the team mask, not transparency. Straight alpha
    # would premultiply the colour to black wherever the mask is 0.
    img.alpha_mode = "CHANNEL_PACKED"
    # An imported file may have brought materials with these names; the
    # exported names must be exactly `body` and `glow` (the gate checks).
    for stale in ("body", "glow"):
        old = bpy.data.materials.get(stale)
        if old is not None:
            bpy.data.materials.remove(old)
    body = bpy.data.materials.new("body")
    body.use_nodes = True
    nt = body.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Specular IOR Level"].default_value = 0.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    body.blend_method = "OPAQUE"
    glow = bpy.data.materials.new("glow")
    glow.use_nodes = True
    g = glow.node_tree.nodes["Principled BSDF"]
    gc = slot_colour("glow", pal, overrides)
    g.inputs["Base Color"].default_value = (0, 0, 0, 1)
    g.inputs["Emission Color"].default_value = (*palette.linear(gc), 1)
    g.inputs["Emission Strength"].default_value = 1.0
    g.inputs["Roughness"].default_value = 1.0
    me = ob.data
    slots = [m.name.split(".", 1)[1] for m in me.materials]
    n = len(slots)
    # Append the two new materials, point every polygon at one of them, then
    # pop the old slots off the front. `materials.clear()` would reset every
    # polygon's index to 0 and lose the glow assignment -- it did, once.
    me.materials.append(body)
    me.materials.append(glow)
    for poly in me.polygons:
        poly.material_index = n + (1 if slots[poly.material_index] in GLOW_SLOTS else 0)
    for _ in range(n):
        me.materials.pop(index=0)
