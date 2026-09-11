# art/scripts

Headless Blender entry points and helpers, invoked by `tools/art/` as
`blender --background --python art/scripts/<name>.py -- <args>`. They import the
generator package from `art/generators/`. Nothing here is imported by the client.
