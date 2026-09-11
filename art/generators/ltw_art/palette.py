"""
The palette, by name. Mirrors docs/art/style-sheet.md §3; a test fails if
the two disagree, and registry.json carries the same table so spec-validate
can check names without importing Python.
"""

COLOURS: dict[str, str] = {
    "stone": "#8f9399",
    "stone_dark": "#5f646b",
    "stone_blue": "#7d8aa0",
    "wood": "#6e4a29",
    "wood_dark": "#4a301a",
    "iron": "#3c3f45",
    "bronze": "#b8813f",
    "gold": "#e2b64a",
    "bone": "#e8dcc0",
    "moss": "#3f7f2c",
    "tawny": "#b0844c",
    "umber": "#9a6a48",
    "venom": "#7ccf5a",
    "danger": "#ff5a3c",
    "violet": "#b48ce0",
    "ice": "#a9e6ff",
    "ice_deep": "#5cc3ef",
    "team_blue": "#4f8cc9",
    "team_red": "#d0483c",
}

ALIASES: dict[str, str] = {
    "creep_skin_1": "moss",
    "creep_skin_2": "tawny",
    "creep_skin_3": "umber",
}


def resolve(name: str) -> str:
    """Palette name or alias to hex. Raises on anything else."""
    if name in ALIASES:
        name = ALIASES[name]
    if name not in COLOURS:
        raise KeyError(f"{name!r} is not a palette colour")
    return COLOURS[name]


def rgb(name_or_hex: str) -> tuple[float, float, float]:
    """Linear-ish 0..1 triple. sRGB values are passed straight through: the
    toon look wants the palette's numbers on screen, not a gamma-corrected
    version of them, and Blender's colour management is set to Standard."""
    h = name_or_hex if name_or_hex.startswith("#") else resolve(name_or_hex)
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4))  # type: ignore[return-value]


def linear(c: tuple[float, float, float]) -> tuple[float, float, float]:
    """sRGB → linear, for a Blender node input. Blender treats every node
    colour as linear and encodes to sRGB on the way into an sRGB image, so a
    palette value fed in raw comes out brighter than it was written; the
    palette's numbers are what the texture must hold."""
    def one(v: float) -> float:
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

    return (one(c[0]), one(c[1]), one(c[2]))


def mix(a: str, b: str, t: float) -> tuple[float, float, float]:
    """Blend two colours; this is the tier shift."""
    ra, rb = rgb(a), rgb(b)
    return tuple(ra[i] + (rb[i] - ra[i]) * t for i in range(3))  # type: ignore[return-value]
