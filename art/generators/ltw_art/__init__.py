"""
ltw_art -- the generator library behind the asset factory.

Runs inside Blender (`blender --background --python art/scripts/build.py`)
and, for everything that is arithmetic rather than geometry, outside it:
the layout of every body plan, the keys of every animation, the registry
and the parameter checks import no `bpy` and are tested with plain pytest.

Layering, strictly one-way:

    palette, rng, mathx, frame, layout, params, registry   pure
    plans/, parts/, rigs/, anims/                          pure: produce data
    bl/                                                    Blender: realise data
    build                                                  orchestrates

`GENERATOR_VERSION` is part of every build-cache key. Bump it when a change
alters the bytes a spec produces; a spec whose build predates the bump is
"stale" in `asset-report`.
"""

GENERATOR_VERSION = "0.1.3"

from . import palette, rng, mathx, frame, layout, params, registry  # noqa: E402,F401
