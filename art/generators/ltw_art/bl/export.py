"""
glTF export with the conventions applied. The operator's keyword names have
moved between Blender versions, so the call passes only the options this
Blender knows -- an unknown one would raise and a silently dropped one would
export the wrong thing, so each is checked by name first.
"""

from __future__ import annotations

import bpy


def _supported(name: str) -> bool:
    return name in bpy.ops.export_scene.gltf.get_rna_type().properties


def export_glb(path: str, animated: bool) -> dict:
    wanted = {
        "filepath": path,
        "export_format": "GLB",
        "export_yup": True,
        "export_apply": True,
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": False,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
        "use_selection": False,
        "export_animations": animated,
        "export_animation_mode": "NLA_TRACKS",
        "export_frame_range": True,
        "export_force_sampling": True,
        "export_optimize_animation_size": False,
        "export_anim_single_armature": True,
        "export_reset_pose_bones": True,
        "export_skins": animated,
        "export_def_bones": False,
        "export_all_influences": False,
        "export_morph": False,
        "export_hierarchy_flatten_bones": False,
        "export_leaf_bone": False,
        "export_nla_strips_merged_animation_name": "Animation",
        "export_try_sparse_sk": False,
        "export_original_specular": False,
        "export_unused_images": False,
        "export_unused_textures": False,
    }
    used = {k: v for k, v in wanted.items() if _supported(k)}
    dropped = sorted(k for k in wanted if k not in used)
    bpy.ops.export_scene.gltf(**used)
    return {"options": used, "unsupported_options": dropped}
