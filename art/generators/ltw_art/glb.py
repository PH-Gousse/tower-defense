"""
A small GLB reader/writer, pure Python, for the two things the factory needs
to do to an exported file without Blender: canonicalise it so a build is
byte-reproducible, and read its counts for the dry-run log and the gate.

Blender's glTF exporter writes the same vertices in the same order every
time, but the order of TRIANGLES inside an index buffer varies between
processes (measured: same triangle set, different order, every run). The
positions, normals, UVs, skin weights, animation samplers and the texture
are all stable. So `canonicalise` rewrites each index buffer with every
triangle rotated so its smallest index comes first (winding kept) and the
triangles sorted -- a canonical form that depends only on the mesh.
"""

from __future__ import annotations

import json
import struct

import numpy as np

MAGIC = 0x46546C67
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT = {5121: np.uint8, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


def read(path: str) -> tuple[dict, bytearray]:
    b = open(path, "rb").read()
    magic, _version, _length = struct.unpack_from("<III", b, 0)
    if magic != MAGIC:
        raise ValueError(f"{path}: not a GLB")
    off = 12
    doc: dict | None = None
    bin_: bytearray = bytearray()
    while off < len(b):
        clen, ctype = struct.unpack_from("<II", b, off)
        data = b[off + 8 : off + 8 + clen]
        if ctype == JSON_CHUNK:
            doc = json.loads(data)
        elif ctype == BIN_CHUNK:
            bin_ = bytearray(data)
        off += 8 + clen
    if doc is None:
        raise ValueError(f"{path}: no JSON chunk")
    return doc, bin_


def write(path: str, doc: dict, bin_: bytes) -> None:
    js = json.dumps(doc, separators=(",", ":"), sort_keys=False).encode()
    js += b" " * (-len(js) % 4)
    bn = bytes(bin_) + b"\0" * (-len(bin_) % 4)
    total = 12 + 8 + len(js) + 8 + len(bn)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", MAGIC, 2, total))
        f.write(struct.pack("<II", len(js), JSON_CHUNK))
        f.write(js)
        f.write(struct.pack("<II", len(bn), BIN_CHUNK))
        f.write(bn)


def accessor_array(doc: dict, bin_: bytes, index: int) -> np.ndarray:
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    dt = COMPONENT[acc["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
    start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride")
    if stride and stride != n * np.dtype(dt).itemsize:
        raise ValueError("interleaved accessors are not handled")
    return np.frombuffer(bin_, dtype=dt, count=acc["count"] * n, offset=start).reshape(acc["count"], n)


def canonicalise(path: str) -> int:
    """Rewrite in place. Returns the number of primitives touched."""
    doc, bin_ = read(path)
    touched = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            if "indices" not in prim or prim.get("mode", 4) != 4:
                continue
            acc = doc["accessors"][prim["indices"]]
            tris = accessor_array(doc, bin_, prim["indices"]).reshape(-1, 3).copy()
            # Rotate each triangle so the smallest index leads (winding kept).
            k = tris.argmin(axis=1)
            rows = np.arange(len(tris))
            tris = np.stack([tris[rows, k], tris[rows, (k + 1) % 3], tris[rows, (k + 2) % 3]], axis=1)
            order = np.lexsort((tris[:, 2], tris[:, 1], tris[:, 0]))
            tris = tris[order]
            view = doc["bufferViews"][acc["bufferView"]]
            start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
            raw = tris.astype(COMPONENT[acc["componentType"]]).tobytes()
            bin_[start : start + len(raw)] = raw
            touched += 1
    write(path, doc, bin_)
    return touched


def summary(path: str) -> dict:
    """Counts the gate and the manifest need."""
    doc, bin_ = read(path)
    tris = 0
    verts = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            if "indices" in prim:
                tris += doc["accessors"][prim["indices"]]["count"] // 3
            verts += doc["accessors"][prim["attributes"]["POSITION"]]["count"]
    images = []
    for i, img in enumerate(doc.get("images", [])):
        images.append({"name": img.get("name", f"image{i}"), "mimeType": img.get("mimeType"), "bytes": doc["bufferViews"][img["bufferView"]]["byteLength"] if "bufferView" in img else None})
    anims = []
    for a in doc.get("animations", []):
        tmax = max(doc["accessors"][s["input"]]["max"][0] for s in a["samplers"])
        anims.append({"name": a["name"], "seconds": round(float(tmax), 4), "channels": len(a["channels"]), "extras": a.get("extras")})
    skins = [{"name": s.get("name"), "joints": len(s["joints"])} for s in doc.get("skins", [])]
    return {
        "triangles": tris,
        "vertices": verts,
        "materials": [m.get("name") for m in doc.get("materials", [])],
        "images": images,
        "animations": anims,
        "skins": skins,
        "nodes": [n.get("name") for n in doc.get("nodes", [])],
        "bytes": 12 + sum(8 + len(c) for c in (json.dumps(doc).encode(), bin_)),
    }
