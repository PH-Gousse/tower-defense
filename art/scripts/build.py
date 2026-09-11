"""
Headless entry point:

    blender --background --python art/scripts/build.py -- --spec <resolved.json> --out <file.glb> [--log <file.json>]

Reads a RESOLVED spec (spec-validate --print writes one), builds it with the
generator library, and exits non-zero on any failure so the calling tool
sees it. Prints one line of JSON last, like every other tool here.
"""

import argparse
import json
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "generators"))

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--spec", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--log")
ap.add_argument("--preview")
ap.add_argument("--blend", help="also save the built scene as a .blend, for inspection")
args = ap.parse_args(argv)

try:
    from ltw_art.build import build

    with open(args.spec) as f:
        spec = json.load(f)
    log = build(spec, os.path.abspath(args.out), os.path.abspath(args.log) if args.log else None, os.path.abspath(args.preview) if args.preview else None)
    if args.blend:
        import bpy

        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    print(json.dumps({"tool": "build.py", "ok": True, "id": spec["id"], "seconds": log["seconds"], "glb": args.out}))
    sys.exit(0)
except Exception as e:  # noqa: BLE001
    traceback.print_exc()
    print(json.dumps({"tool": "build.py", "ok": False, "error": f"{type(e).__name__}: {e}"}))
    sys.exit(1)
