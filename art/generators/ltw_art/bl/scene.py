from __future__ import annotations

import bpy


def reset(fps: int = 24) -> None:
    """A clean, factory-default scene with nothing in it. Every build starts
    here so what a previous build left in memory cannot leak into this one --
    the first thing a determinism bug looks like is 'it depends on what you
    built before'."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = fps
    sc.render.fps_base = 1.0
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
    # The palette's numbers are what should reach the screen.
    sc.view_settings.view_transform = "Standard"
    sc.display_settings.display_device = "sRGB"


def deselect_all() -> None:
    for o in bpy.context.view_layer.objects:
        if o is not None:  # a just-removed object lingers as None until the next update
            o.select_set(False)


def select_only(*objs) -> None:
    deselect_all()
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0] if objs else None
