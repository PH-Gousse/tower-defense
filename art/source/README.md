# Source files

`.blend` (and `.psd`, `.wav`) for hand-made or imported assets. Interactive Blender work,
with or without the Blender MCP connection, saves here.

A file here is **not** an asset. It becomes one through `/asset import <file> --as <id>`,
which writes the spec, records the source and licence, and sends it through the same gate
and previews as a generated asset. Nothing goes from here to `assets/build/` directly.

Large binaries: see the Git LFS note in `docs/art/pipeline.md`.
