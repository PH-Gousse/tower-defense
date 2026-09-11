# assets/build

**Gate output only. Never edited by hand.** A hook rejects any edit here and to
`assets/manifest.json`; the way to change a file in this directory is to change its spec
and run `asset-build` then `asset-gate`.

Committed as plain files (ADR-0018). Every file is reproducible from `art/specs/<id>.yaml`
plus `art/generators/` at the commit recorded in the manifest.
