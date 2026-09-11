"""
    python3 art/scripts/dry_run.py <resolved.json> [...]

What a build WOULD produce, without Blender: primitives, an estimated
triangle count, height, bones, clips. One JSON line per spec, last line a
summary. Used by `asset-build --dry-run` and by the tests.
"""

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "generators"))

from ltw_art.build import dry_run  # noqa: E402

ok = True
out = []
for path in sys.argv[1:]:
    with open(path) as f:
        spec = json.load(f)
    try:
        out.append(dry_run(spec))
    except Exception as e:  # noqa: BLE001
        ok = False
        out.append({"id": spec.get("id"), "error": f"{type(e).__name__}: {e}"})
print(json.dumps({"tool": "dry_run.py", "ok": ok, "specs": out}))
sys.exit(0 if ok else 1)
