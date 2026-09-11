"""
generators.md, written from the registry. Run:

    python3 -m ltw_art.docs > art/generators/generators.md

A test regenerates it and fails on a diff, so the reference cannot lag the
code. Every body plan, part, rig and animation generator is listed with its
parameters, defaults, ranges and one-paragraph doc.
"""

from __future__ import annotations

from .params import P
from .registry import load_all


def _params(params: dict[str, P]) -> list[str]:
    if not params:
        return ["", "*No parameters.*"]
    out = ["", "| Parameter | Default | Range | Meaning |", "|---|---|---|---|"]
    for name, p in params.items():
        if p.enum:
            rng = " / ".join(f"`{e}`" for e in p.enum)
        elif p.min is not None or p.max is not None:
            rng = f"{p.min if p.min is not None else ''} .. {p.max if p.max is not None else ''}"
        else:
            rng = ""
        out.append(f"| `{name}` | `{p.default}` | {rng} | {p.doc} |")
    return out


def render() -> str:
    from . import GENERATOR_VERSION

    r = load_all()
    L: list[str] = [
        "# Generator reference",
        "",
        f"*Generated from `art/generators/ltw_art` (version {GENERATOR_VERSION}) by `python3 -m ltw_art.docs`. Do not edit.*",
        "",
        "Every name a spec may use: body plans and their parameters, parts and where they attach, rig templates and their bones, animation generators and the clips they produce. `spec-validate` checks specs against the same tables (`registry.json`).",
        "",
        "## Body plans",
    ]
    for name, d in sorted(r.body_plans.items()):
        L += ["", f"### `{name}` — {d.cls}", "", d.doc, "", f"**Attachment points:** {', '.join(f'`{a}`' for a in d.attachments) or 'none'}  ", f"**Material slots:** {', '.join(f'`{s}`' for s in d.slots) or 'none'}"]
        L += _params(d.params)
    L += ["", "## Parts", "", "A part is placed at an attachment point and scales with it. `triangles` is the part's own cost at scale 1.", "", "| Part | Attaches at | Default | Slots | Triangles | Description |", "|---|---|---|---|---|---|"]
    for name, d in sorted(r.parts.items()):
        L.append(f"| `{name}` | {', '.join(f'`{a}`' for a in d.attaches)} | `{d.default_at}` | {', '.join(f'`{s}`' for s in d.slots)} | {d.triangles} | {d.doc.replace(chr(10), ' ')} |")
    L += ["", "## Rig templates"]
    for name, d in sorted(r.rigs.items()):
        L += ["", f"### `{name}`", "", d.doc, "", f"**Fits:** {', '.join(f'`{p}`' for p in d.plans)}  ", f"**Bones ({len(d.bones)}):** {', '.join(f'`{b}`' for b in d.bones)}  ", f"**IK:** {', '.join(f'`{b}`' for b in d.ik) or 'none'}"]
    L += ["", "## Animation generators"]
    for name, d in sorted(r.animations.items()):
        L += ["", f"### `{name}` — {' / '.join(d.clips)}, {'loop' if d.loop else 'one-shot'}", "", d.doc]
        L += _params(d.params)
    L.append("")
    return "\n".join(L)


if __name__ == "__main__":
    import sys

    from ltw_art.docs import render as real_render  # the real module, not this __main__ copy

    sys.stdout.write(real_render())
