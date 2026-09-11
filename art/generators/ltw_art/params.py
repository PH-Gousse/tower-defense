"""
Parameter declarations. Every body plan, part and animation generator
declares its parameters once, with a default and a range or an enum; the
same declaration feeds the registry (for spec-validate), the docs
(generators.md) and the runtime check.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class P:
    default: float | int | bool | str
    min: float | None = None
    max: float | None = None
    enum: tuple[str, ...] | None = None
    doc: str = ""

    def to_json(self) -> dict:
        out: dict = {"default": self.default}
        if self.min is not None:
            out["min"] = self.min
        if self.max is not None:
            out["max"] = self.max
        if self.enum is not None:
            out["enum"] = list(self.enum)
        if self.doc:
            out["doc"] = self.doc
        return out


SEED = P(0, 0, 65535, doc="Extra entropy on top of the spec id, for variants of one plan.")


def resolve(declared: dict[str, P], given: dict, where: str) -> dict:
    """Defaults filled, ranges checked, unknown names refused. Returns a new
    dict. `parts` is passed through untouched: it is the spec's, not the
    plan's."""
    out: dict = {}
    for name, p in declared.items():
        v = given.get(name, p.default)
        if p.enum is not None:
            if v not in p.enum:
                raise ValueError(f"{where}.{name}: {v!r} is not one of {', '.join(p.enum)}")
        elif isinstance(p.default, bool):
            if not isinstance(v, bool):
                raise ValueError(f"{where}.{name}: expected true/false, got {v!r}")
        else:
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(f"{where}.{name}: expected a number, got {v!r}")
            if p.min is not None and v < p.min:
                raise ValueError(f"{where}.{name}: {v} is below the minimum {p.min}")
            if p.max is not None and v > p.max:
                raise ValueError(f"{where}.{name}: {v} is above the maximum {p.max}")
        out[name] = v
    for name in given:
        if name not in declared and name != "parts":
            raise ValueError(f"{where}: no parameter named {name!r}; it has {', '.join(declared) or 'none'}")
    if "parts" in given:
        out["parts"] = given["parts"]
    return out
