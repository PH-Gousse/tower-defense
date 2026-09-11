"""
Determinism: every bit of randomness a generator uses comes from here, seeded
by the spec id (and an optional per-use label), never from the clock or from
Python's global `random`.
"""

import hashlib
import random


def seed_for(spec_id: str, label: str = "") -> int:
    h = hashlib.sha256(f"{spec_id}:{label}".encode()).digest()
    return int.from_bytes(h[:8], "big")


def rng_for(spec_id: str, label: str = "") -> random.Random:
    return random.Random(seed_for(spec_id, label))
