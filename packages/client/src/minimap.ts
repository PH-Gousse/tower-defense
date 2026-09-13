import {
  GRID_W,
  GRID_H,
  SPAWN_ROWS,
  EXIT_ROW_MIN,
  TOWER_SIZE,
  type GameState,
  type Lane,
} from '@ltw/sim'

/**
 * The minimap: both lanes full-length as a tall thumbnail (ADR-0024).
 *
 * The lane is 213 rows and the camera shows 20 of them, so most of the match
 * is off-screen most of the time. The minimap is where the rest of it is:
 * every tower's footprint, every creep as a dot in its owner's colour, the
 * spawn and exit zones, and the rectangle the camera is looking at. Click or
 * drag on it to jump.
 *
 * Two halves. The MAPPING -- tiles to pixels and back, how tall the thumbnail
 * is for a given viewport -- is pure and lives in `minimapLayout`,
 * `worldToMinimap` and `minimapToWorld`, because a click that lands a row off
 * is the kind of bug a screenshot never shows and a test always does. The
 * DRAWING is a 2D canvas the scene repaints from the sim snapshot a few times
 * a second, never per frame: at four hertz a 500-creep lane is two thousand
 * fills a second, which is nothing, and at sixty it would be thirty thousand
 * for a picture whose dots move a pixel a second.
 *
 * World x runs across (lane 0 at the origin, lane 1 across the gap); world z
 * runs down the lane, and the minimap draws it downward too, so the top of
 * the thumbnail is the spawn zone -- the same way up as the screen.
 */

/** Pixels per tile the minimap prefers on a desktop, per ADR-0024. */
export const MINIMAP_SCALE_MAX = 2
/** Never smaller than this: a 1-tile creep must still be a pixel. */
export const MINIMAP_SCALE_MIN = 1
/** Tiles of margin drawn around the content, so the edges read as edges. */
const MINIMAP_MARGIN = 1

export interface MinimapLayout {
  /** Pixels per tile. */
  readonly scale: number
  /** Canvas size in CSS pixels. */
  readonly width: number
  readonly height: number
  /** World x of the leftmost drawn tile edge, world z of the topmost. */
  readonly originX: number
  readonly originZ: number
}

/**
 * Size the thumbnail to the room it has.
 *
 * `contentW` is both lanes plus the gap in tiles; the height is the whole lane.
 * The scale is the largest whole-or-half step that fits, capped at
 * `MINIMAP_SCALE_MAX`, floored at `MINIMAP_SCALE_MIN`: a phone gets 1px per
 * tile and a 213px-tall strip, a desktop 2px and 426px.
 */
export function minimapLayout(contentW: number, availW: number, availH: number): MinimapLayout {
  const tilesW = contentW + 2 * MINIMAP_MARGIN
  const tilesH = GRID_H + 2 * MINIMAP_MARGIN
  let scale = Math.min(availW / tilesW, availH / tilesH, MINIMAP_SCALE_MAX)
  // Half-pixel steps keep tile edges crisp on a 2x display and leave room
  // between "2" and "1" on a laptop that has 380px, not 430, to spare.
  scale = Math.floor(scale * 2) / 2
  if (scale < MINIMAP_SCALE_MIN) scale = MINIMAP_SCALE_MIN
  return {
    scale,
    width: Math.ceil(tilesW * scale),
    height: Math.ceil(tilesH * scale),
    originX: -MINIMAP_MARGIN,
    originZ: -MINIMAP_MARGIN,
  }
}

/** World (x, z) in tiles to minimap pixels. */
export function worldToMinimap(
  layout: MinimapLayout,
  x: number,
  z: number,
  out: { x: number; y: number },
): { x: number; y: number } {
  out.x = (x - layout.originX) * layout.scale
  out.y = (z - layout.originZ) * layout.scale
  return out
}

/** Minimap pixels to world (x, z) in tiles. The inverse of `worldToMinimap`. */
export function minimapToWorld(
  layout: MinimapLayout,
  px: number,
  py: number,
  out: { x: number; z: number },
): { x: number; z: number } {
  out.x = px / layout.scale + layout.originX
  out.z = py / layout.scale + layout.originZ
  return out
}

export interface MinimapColours {
  readonly turf: string
  readonly spawn: string
  readonly exit: string
  readonly tower: string
  /** Creep dot by owner index: the sender's colour, since a creep is theirs. */
  readonly creep: readonly [string, string]
  readonly viewport: string
  readonly frame: string
}

export const MINIMAP_COLOURS: MinimapColours = {
  turf: '#2d3d22',
  spawn: 'rgba(110, 240, 160, 0.55)',
  exit: 'rgba(250, 120, 90, 0.55)',
  tower: '#d8c8a0',
  creep: ['#7ab2ec', '#e7574a'],
  viewport: 'rgba(243, 198, 80, 0.95)',
  frame: '#0a0704',
}

export interface MinimapView {
  readonly minX: number
  readonly minZ: number
  readonly maxX: number
  readonly maxZ: number
}

/**
 * Paint one frame of the minimap onto `ctx`.
 *
 * `laneX(i)` is where lane `i` is drawn in world x, the same function the
 * scene uses, so the thumbnail and the board cannot disagree about which lane
 * is on which side once the seat is known.
 */
export function paintMinimap(
  ctx: CanvasRenderingContext2D,
  layout: MinimapLayout,
  state: GameState,
  laneX: (lane: number) => number,
  view: MinimapView,
  colours: MinimapColours = MINIMAP_COLOURS,
): void {
  const s = layout.scale
  ctx.fillStyle = colours.frame
  ctx.fillRect(0, 0, layout.width, layout.height)

  for (let l = 0; l < state.lanes.length; l++) {
    const ox = (laneX(l) - layout.originX) * s
    const oz = -layout.originZ * s
    ctx.fillStyle = colours.turf
    ctx.fillRect(ox, oz, GRID_W * s, GRID_H * s)
    ctx.fillStyle = colours.spawn
    ctx.fillRect(ox, oz, GRID_W * s, SPAWN_ROWS * s)
    ctx.fillStyle = colours.exit
    ctx.fillRect(ox, oz + EXIT_ROW_MIN * s, GRID_W * s, (GRID_H - EXIT_ROW_MIN) * s)

    const lane = state.lanes[l] as Lane
    const t = lane.towers
    ctx.fillStyle = colours.tower
    for (let i = 0; i < t.count; i++) {
      ctx.fillRect(
        ox + (t.anchorX[i] as number) * s,
        oz + (t.anchorY[i] as number) * s,
        TOWER_SIZE * s,
        TOWER_SIZE * s,
      )
    }

    // Creeps last so they sit on top of the towers they are walking past. A
    // dot is one tile; at 1px per tile that is one pixel, which is the floor.
    const c = lane.creeps
    const dot = Math.max(1, s)
    for (let owner = 0; owner < 2; owner++) {
      ctx.fillStyle = colours.creep[owner as 0 | 1]
      for (let i = 0; i < c.count; i++) {
        if (c.owner[i] !== owner) continue
        ctx.fillRect(ox + Math.floor(c.x[i] as number) * s, oz + Math.floor(c.y[i] as number) * s, dot, dot)
      }
    }
  }

  // The camera's window, clipped to the canvas so a view hanging past the
  // content still shows where its edge is.
  ctx.strokeStyle = colours.viewport
  ctx.lineWidth = 1
  const x0 = (view.minX - layout.originX) * s
  const y0 = (view.minZ - layout.originZ) * s
  const x1 = (view.maxX - layout.originX) * s
  const y1 = (view.maxZ - layout.originZ) * s
  ctx.strokeRect(
    Math.max(0.5, Math.min(layout.width - 0.5, x0)) ,
    Math.max(0.5, Math.min(layout.height - 0.5, y0)),
    Math.min(layout.width - 1, x1) - Math.max(0.5, x0),
    Math.min(layout.height - 1, y1) - Math.max(0.5, y0),
  )
}
