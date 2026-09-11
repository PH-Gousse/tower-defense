"""
Headless entry point:

    blender --background --python art/scripts/build.py -- --spec <resolved.json> --out <file.glb> [--log <file.json>] [--preview <png>] [--blend <file.blend>]
    blender --background --python art/scripts/build.py -- --batch <batch.json>

Reads RESOLVED specs (spec-validate --print or asset-build write them),
builds each with the generator library, and exits non-zero on any failure
so the calling tool sees it. A batch is a JSON list of
{id, spec, out, log, preview, cache_key, spec_hash}; every entry is built
in this one process and the build log records the cache key so
asset-build can skip it next time. Prints one line of JSON last.
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
ap.add_argument("--spec")
ap.add_argument("--out")
ap.add_argument("--log")
ap.add_argument("--preview")
ap.add_argument("--blend", help="also save the built scene as a .blend, for inspection")
ap.add_argument("--batch")
ap.add_argument("--result", help="write the JSON result here as well as to stdout")
args = ap.parse_args(argv)

from ltw_art.build import build  # noqa: E402


def one(spec_path, out, log, preview, blend=None, cache_key=None, spec_hash=None):
    with open(spec_path) as f:
        spec = json.load(f)
    result = build(spec, os.path.abspath(out), None, os.path.abspath(preview) if preview else None)
    result["cache_key"] = cache_key
    result["spec_hash"] = spec_hash
    if log:
        with open(os.path.abspath(log), "w") as f:
            json.dump(result, f, indent=2)
    if blend:
        import bpy

        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
    return result


if args.batch:
    with open(args.batch) as f:
        batch = json.load(f)
    results = []
    all_ok = True
    for entry in batch:
        try:
            r = one(entry["spec"], entry["out"], entry.get("log"), entry.get("preview"), None, entry.get("cache_key"), entry.get("spec_hash"))
            results.append({"id": entry["id"], "ok": True, "seconds": r["seconds"]})
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            all_ok = False
            results.append({"id": entry["id"], "ok": False, "error": f"{type(e).__name__}: {e}"})
    result = {"tool": "build.py", "ok": all_ok, "results": results}
    if args.result:
        with open(args.result, "w") as f:
            json.dump(result, f)
    print(json.dumps(result))
    sys.exit(0 if all_ok else 1)

if not (args.spec and args.out):
    print(json.dumps({"tool": "build.py", "ok": False, "error": "--spec and --out, or --batch"}))
    sys.exit(2)
try:
    r = one(args.spec, args.out, args.log, args.preview, args.blend)
    print(json.dumps({"tool": "build.py", "ok": True, "id": r["id"], "seconds": r["seconds"], "glb": args.out}))
    sys.exit(0)
except Exception as e:  # noqa: BLE001
    traceback.print_exc()
    print(json.dumps({"tool": "build.py", "ok": False, "error": f"{type(e).__name__}: {e}"}))
    sys.exit(1)
