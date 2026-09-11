/**
 * The per-class budgets, for the viewer's numbers. The gate is the
 * authority (tools/art/lib/budgets.ts); this copy exists because the client
 * bundle cannot import from tools/. A client test pins the two together.
 */
export const BUDGETS: Record<string, { triangles: number; bones: number; bytes: number; textureSize: number }> = {
  creep: { triangles: 1500, bones: 20, bytes: 400 * 1024, textureSize: 512 },
  tower: { triangles: 2500, bones: 6, bytes: 500 * 1024, textureSize: 512 },
  projectile: { triangles: 100, bones: 0, bytes: 30 * 1024, textureSize: 128 },
  effect: { triangles: 100, bones: 0, bytes: 30 * 1024, textureSize: 128 },
  tile: { triangles: 200, bones: 0, bytes: 50 * 1024, textureSize: 256 },
  prop: { triangles: 200, bones: 0, bytes: 50 * 1024, textureSize: 256 },
}
