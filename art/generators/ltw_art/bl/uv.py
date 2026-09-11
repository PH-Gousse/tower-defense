"""
Deterministic UVs.

Blender's unwrap and pack operators (smart_project, cube_project,
pack_islands) produce different layouts on every run -- measured: four
methods, two processes, eight different hashes -- and a texture whose islands
move is a glb whose bytes move. So the atlas is laid out here, in numpy, from
nothing but the mesh: every face is projected along the dominant axis of its
normal, faces of one primitive that share an axis and sign form an island,
and the islands are shelf-packed in a fixed order. Same mesh, same UVs, every
time, on every machine.

Island boundaries follow primitives, so the bake's colour blocks fall on
island edges and the margin never bleeds one slot's colour into another's.
"""

from __future__ import annotations

import numpy as np

AXES = np.eye(3)


def _islands(ob) -> list[dict]:
    me = ob.data
    n_poly = len(me.polygons)
    prim = np.zeros(n_poly, dtype=np.int32)
    attr = me.attributes.get("prim")
    if attr is not None:
        attr.data.foreach_get("value", prim)
    normals = np.empty(n_poly * 3, dtype=np.float32)
    me.polygon_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    verts = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", verts)
    verts = verts.reshape(-1, 3)
    loop_vert = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_vert)
    loop_start = np.empty(n_poly, dtype=np.int32)
    loop_total = np.empty(n_poly, dtype=np.int32)
    me.polygons.foreach_get("loop_start", loop_start)
    me.polygons.foreach_get("loop_total", loop_total)

    axis = np.abs(normals).argmax(axis=1)
    sign = np.sign(normals[np.arange(n_poly), axis]).astype(np.int32)
    sign[sign == 0] = 1
    groups: dict[tuple[int, int, int], list[int]] = {}
    for i in range(n_poly):
        groups.setdefault((int(prim[i]), int(axis[i]), int(sign[i])), []).append(i)

    islands = []
    for key in sorted(groups):
        polys = groups[key]
        a = key[1]
        u_axis, v_axis = [(1, 2), (2, 0), (0, 1)][a]
        loops = np.concatenate([np.arange(loop_start[p], loop_start[p] + loop_total[p]) for p in polys])
        co = verts[loop_vert[loops]]
        uv = np.stack([co[:, u_axis] * key[2] * (-1 if a == 1 else 1), co[:, v_axis]], axis=1)
        lo = uv.min(axis=0)
        uv = uv - lo
        islands.append({"key": key, "loops": loops, "uv": uv, "size": uv.max(axis=0)})
    return islands


def _shelf_pack(sizes: list[tuple[float, float]], margin: float) -> tuple[list[tuple[float, float]], float]:
    """Rows of islands, tallest first. Returns offsets and the used height;
    width is always ≤ 1."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0], i))
    offsets: list[tuple[float, float] | None] = [None] * len(sizes)
    x = y = row_h = 0.0
    for i in order:
        w, h = sizes[i]
        if x + w + margin > 1.0 and x > 0.0:
            x = 0.0
            y += row_h + margin
            row_h = 0.0
        offsets[i] = (x + margin / 2, y + margin / 2)
        x += w + margin
        row_h = max(row_h, h)
    return offsets, y + row_h + margin  # type: ignore[return-value]


def layout_uvs(ob, size: int, margin_px: int = 4) -> dict:
    islands = _islands(ob)
    margin = margin_px / size
    total = sum(float(i["size"][0] * i["size"][1]) for i in islands) or 1.0
    scale = (0.75 / total) ** 0.5
    for _ in range(60):
        sizes = [(float(i["size"][0]) * scale, float(i["size"][1]) * scale) for i in islands]
        if all(w + margin <= 1.0 for w, _ in sizes):
            offsets, used = _shelf_pack(sizes, margin)
            if used <= 1.0:
                break
        scale *= 0.94
    else:
        raise RuntimeError("could not pack UV islands")
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv_layer = me.uv_layers[0]
    out = np.zeros((len(me.loops), 2), dtype=np.float32)
    for isl, off in zip(islands, offsets):
        out[isl["loops"]] = isl["uv"] * scale + np.array(off, dtype=np.float32)
    uv_layer.data.foreach_set("uv", out.ravel())
    return {"islands": len(islands), "texel_scale": float(scale), "atlas_used": float(used)}
