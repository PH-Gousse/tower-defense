"""
A clip is keys on named bones, in the game frame, plus the contract's
metadata. Rotations are XYZ eulers ABOUT THE BONE'S HEAD in the game frame
(the space the bone would be in if every parent were at rest), and
translations are game-frame offsets: `bl/anim.py` converts both into the
bone's local basis using the armature's actual rest matrices. Generators
therefore never need to know which way a bone's local X points.

Loops are seamless by construction: every loop generator samples a periodic
function of phase = frame / frames, and the last frame is one step short of
the first, so frame 0 and frame N coincide.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Key:
    bone: str
    frame: int
    loc: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rot: tuple[float, float, float] = (0.0, 0.0, 0.0)
    scale: tuple[float, float, float] = (1.0, 1.0, 1.0)


@dataclass
class Clip:
    name: str
    fps: int
    frames: int  # number of sampled frames; a loop's period is `frames` frames
    loop: bool
    keys: list[Key] = field(default_factory=list)
    markers: dict[str, float] = field(default_factory=dict)  # normalised time
    stride: float | None = None  # Walk: tiles per cycle, for the client's timeScale

    @property
    def seconds(self) -> float:
        return self.frames / self.fps

    def key(self, bone: str, frame: int, loc=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0), scale=(1.0, 1.0, 1.0)) -> None:
        self.keys.append(Key(bone, frame, tuple(loc), tuple(rot), tuple(scale)))  # type: ignore[arg-type]

    def bones(self) -> list[str]:
        seen: list[str] = []
        for k in self.keys:
            if k.bone not in seen:
                seen.append(k.bone)
        return seen

    def sample_frames(self) -> range:
        """Frames a loop is keyed on: 0..frames-1. The exporter's frame range
        is 0..frames, and frame `frames` is the same pose as frame 0 through
        the cycle; a one-shot is keyed 0..frames inclusive and holds."""
        return range(0, self.frames) if self.loop else range(0, self.frames + 1)


def has(bones: list[str], *names: str) -> bool:
    return all(n in bones for n in names)
