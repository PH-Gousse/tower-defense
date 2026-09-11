# assets/raw

Generator or external output, **exactly as produced**: the `.glb` a body plan exported,
the `.wav` a synthesiser rendered, the file an importer wrote. Nothing here is normalised,
compressed or admitted.

`asset-gate` reads from here and writes to `assets/build/`. This directory is regenerable
from `art/specs/` and `art/generators/` and is gitignored until the LFS decision is made.
