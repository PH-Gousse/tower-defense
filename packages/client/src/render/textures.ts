import * as THREE from 'three'

/**
 * Procedural textures, painted on a canvas at start-up.
 *
 * There is no art pipeline in this project and deliberately no binary assets in
 * the repository: everything the board looks like is described here, in code,
 * so a change to the look is a diff someone can read. The cost is a few
 * milliseconds of 2D drawing when the page loads, once, and it buys a grass
 * field, a stone gate and a soft particle out of nothing but a seed.
 *
 * Every function here is deterministic for a given seed, so two players see
 * the same field. That is cosmetic rather than a determinism rule -- nothing
 * in the sim reads a texture -- but a field that looked different on each
 * reload would read as a bug.
 */

/**
 * mulberry32. Small, fast, and good enough for scattering grass blades. The
 * sim has its own seeded generator; this one exists so the renderer never has
 * to import it and can be seeded independently of the match.
 */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

function texture(c: HTMLCanvasElement, repeat: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping
    t.wrapT = THREE.RepeatWrapping
  }
  t.needsUpdate = true
  return t
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`
}

/** Scatter short strokes of grass over `ctx`. Shared by the field and the lane. */
function grassBlades(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  density: number,
  hueBase: number,
  lightBase: number,
): void {
  const n = Math.floor(w * h * density)
  ctx.lineCap = 'round'
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * w
    const y = y0 + rnd() * h
    const len = 2 + rnd() * 5
    const lean = (rnd() - 0.5) * 3
    const hue = hueBase + (rnd() - 0.5) * 18
    const light = lightBase + (rnd() - 0.5) * 0.16
    ctx.strokeStyle = hsl(hue, 0.45 + rnd() * 0.2, light)
    ctx.lineWidth = 0.8 + rnd() * 1.1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + lean, y - len)
    ctx.stroke()
  }
}

/** Soft darker and lighter patches, so a field is not one flat green. */
function mottle(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  w: number,
  h: number,
  count: number,
  hue: number,
): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w
    const y = rnd() * h
    const r = 12 + rnd() * 40
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const dark = rnd() < 0.5
    g.addColorStop(0, dark ? 'rgba(20,40,12,0.22)' : `hsla(${hue}, 45%, 48%, 0.16)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
}

/**
 * The field the lanes sit in. Tiles seamlessly, at about four tiles per repeat.
 */
export function grassTexture(seed = 1): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  const rnd = seeded(seed)
  ctx.fillStyle = hsl(104, 0.38, 0.27)
  ctx.fillRect(0, 0, S, S)
  mottle(ctx, rnd, S, S, 40, 100)
  // Blades are drawn into a 3x3 tiling so strokes crossing the edge wrap.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const r2 = seeded(seed + 7)
      ctx.save()
      ctx.translate(dx * S, dy * S)
      grassBlades(ctx, r2, 0, 0, S, S, 0.12, 104, 0.34)
      ctx.restore()
    }
  }
  return texture(c, true)
}

export interface LaneTextureOptions {
  readonly width: number
  readonly length: number
  readonly entranceRow: number
  readonly exitRow: number
  readonly spawnTiles: readonly { readonly x: number; readonly y: number }[]
  readonly exitTiles: readonly { readonly x: number; readonly y: number }[]
  /** Lightness of the turf. The opponent's lane is drawn a shade cooler. */
  readonly hue: number
  readonly light: number
  /** CSS colour of the glow on the tiles creeps actually use. */
  readonly spawnGlow: string
  readonly exitGlow: string
}

/** Pixels per tile in the baked lane. On screen a tile is ~30px at the default framing and ~75px zoomed in. */
export const LANE_PX = 64

/**
 * One lane's floor, baked: turf with a countable grid, a cobbled entrance row
 * with glowing spawn runes and a cobbled exit row with glowing exit runes.
 *
 * Baked rather than assembled from tile meshes because the floor never
 * changes: what used to be five instanced meshes and a line set is one quad and
 * one draw call, and the grid can be drawn as a soft groove between tiles
 * rather than a hard line floating above them.
 */
export function laneTexture(o: LaneTextureOptions, seed = 11): THREE.CanvasTexture {
  const W = o.width * LANE_PX
  const H = o.length * LANE_PX
  const [c, ctx] = canvas(W, H)
  const rnd = seeded(seed)

  // Turf, slightly checkered so a tile can be counted at a glance.
  for (let y = 0; y < o.length; y++) {
    for (let x = 0; x < o.width; x++) {
      const even = (x + y) % 2 === 0
      ctx.fillStyle = hsl(o.hue, 0.36, o.light + (even ? 0.02 : -0.02))
      ctx.fillRect(x * LANE_PX, y * LANE_PX, LANE_PX, LANE_PX)
    }
  }
  mottle(ctx, rnd, W, H, o.width * o.length * 0.5, o.hue)
  grassBlades(ctx, rnd, 0, 0, W, H, 0.05, o.hue, o.light + 0.08)

  // Reserved rows: worn cobbles.
  cobbles(ctx, rnd, 0, o.entranceRow * LANE_PX, W, LANE_PX)
  cobbles(ctx, rnd, 0, o.exitRow * LANE_PX, W, LANE_PX)

  // Grid grooves. Drawn after the turf so they sit in it rather than on it.
  ctx.strokeStyle = 'rgba(10, 22, 8, 0.28)'
  ctx.lineWidth = 2
  for (let x = 0; x <= o.width; x++) {
    line(ctx, x * LANE_PX, 0, x * LANE_PX, H)
  }
  for (let y = 0; y <= o.length; y++) {
    line(ctx, 0, y * LANE_PX, W, y * LANE_PX)
  }
  ctx.strokeStyle = 'rgba(200, 230, 160, 0.10)'
  ctx.lineWidth = 1
  for (let x = 0; x <= o.width; x++) line(ctx, x * LANE_PX + 1.5, 0, x * LANE_PX + 1.5, H)
  for (let y = 0; y <= o.length; y++) line(ctx, 0, y * LANE_PX + 1.5, W, y * LANE_PX + 1.5)

  // The tiles creeps really use, lit from beneath.
  for (const t of o.spawnTiles) rune(ctx, t.x, t.y, o.spawnGlow)
  for (const t of o.exitTiles) rune(ctx, t.x, t.y, o.exitGlow)

  return texture(c, false)
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
}

/** A row of flagstones with mortar between them. */
function cobbles(
  ctx: CanvasRenderingContext2D,
  rnd: () => number,
  x0: number,
  y0: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = hsl(30, 0.08, 0.2)
  ctx.fillRect(x0, y0, w, h)
  const stone = 16
  for (let y = y0; y < y0 + h; y += stone) {
    const offset = ((y - y0) / stone) % 2 === 0 ? 0 : stone / 2
    for (let x = x0 - stone; x < x0 + w + stone; x += stone) {
      const sx = x + offset + (rnd() - 0.5) * 2
      const sy = y + (rnd() - 0.5) * 2
      const l = 0.3 + rnd() * 0.14
      ctx.fillStyle = hsl(28 + rnd() * 10, 0.08 + rnd() * 0.05, l)
      roundRect(ctx, sx + 1.5, sy + 1.5, stone - 3, stone - 3, 3)
      ctx.fill()
      // A highlight along the top edge, as if lit from the north.
      ctx.fillStyle = `rgba(255, 240, 220, ${(0.08 + rnd() * 0.06).toFixed(3)})`
      roundRect(ctx, sx + 2.5, sy + 2, stone - 5, 3, 1.5)
      ctx.fill()
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** A glowing circle with an inner ring, centred on a tile. */
function rune(ctx: CanvasRenderingContext2D, tx: number, ty: number, colour: string): void {
  const cx = (tx + 0.5) * LANE_PX
  const cy = (ty + 0.5) * LANE_PX
  const r = LANE_PX * 0.46
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r)
  g.addColorStop(0, colour)
  g.addColorStop(0.55, colour.replace(/[\d.]+\)$/, '0.35)'))
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  ctx.strokeStyle = colour
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2)
  ctx.stroke()
  // Four ticks, so the ring reads as a mark rather than a stain.
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4
    line(
      ctx,
      cx + Math.cos(a) * r * 0.62,
      cy + Math.sin(a) * r * 0.62,
      cx + Math.cos(a) * r * 0.82,
      cy + Math.sin(a) * r * 0.82,
    )
  }
}

/** A soft radial glow. The one sprite every hit, flash and puff is built from. */
export function glowTexture(): THREE.CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return texture(c, false)
}

/** A thin ring, for the splash shockwave and the leak flash. */
export function ringTexture(): THREE.CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)')
  g.addColorStop(0.75, 'rgba(255,255,255,0.5)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return texture(c, false)
}

/** A lumpy, opaque-centred puff for smoke and dust. */
export function puffTexture(seed = 3): THREE.CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  const rnd = seeded(seed)
  for (let i = 0; i < 7; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.4
    const y = S / 2 + (rnd() - 0.5) * S * 0.4
    const r = S * (0.2 + rnd() * 0.18)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
  }
  return texture(c, false)
}

/** A chevron pointing +x, for route markers. */
export function chevronTexture(): THREE.CanvasTexture {
  const S = 64
  const [c, ctx] = canvas(S, S)
  ctx.strokeStyle = 'rgba(255,255,255,1)'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(S * 0.3, S * 0.2)
  ctx.lineTo(S * 0.62, S * 0.5)
  ctx.lineTo(S * 0.3, S * 0.8)
  ctx.stroke()
  return texture(c, false)
}
