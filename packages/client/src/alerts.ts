/**
 * Off-screen alerts: an arrow at the edge of the view when something happened
 * out of sight (ADR-0024).
 *
 * The camera shows a tenth of the lane, so a leak two hundred rows away is
 * silent unless something points at it. Each alert is a direction along the
 * lane (and, more rarely, across it) plus a kind: a LEAK, which is loud and
 * lingers, or FIRE, a tower shooting off-screen, which is quiet and refreshed
 * for as long as the shooting continues. Fire is throttled rather than shown
 * per shot: a maze of two hundred towers fires constantly, and an indicator
 * that is always on says nothing.
 *
 * The classification is pure and tested; the DOM half positions one element
 * per (edge, kind) inside the usable area and lets CSS animate it.
 */

export interface ViewBox {
  readonly minX: number
  readonly minZ: number
  readonly maxX: number
  readonly maxZ: number
}

export interface Edge {
  /** -1 left of the view, 1 right of it, 0 within its width. */
  readonly dx: -1 | 0 | 1
  /** -1 above the view (toward the spawn), 1 below it (toward the exit), 0 within. */
  readonly dz: -1 | 0 | 1
}

/**
 * Which edge of the view a world point lies beyond, or null when it is in
 * view. Along-the-lane wins the tie with across: an event that is both far
 * down the lane and in the other lane is pointed at down the lane, because
 * that is the axis the player scrolls.
 */
export function edgeFor(x: number, z: number, view: ViewBox): Edge | null {
  const dx: -1 | 0 | 1 = x < view.minX ? -1 : x > view.maxX ? 1 : 0
  const dz: -1 | 0 | 1 = z < view.minZ ? -1 : z > view.maxZ ? 1 : 0
  if (dx === 0 && dz === 0) return null
  return { dx, dz }
}

export type AlertKind = 'leak' | 'fire'

/** How long each kind stays up after its last event, in ms. */
export const ALERT_TTL: Record<AlertKind, number> = { leak: 1800, fire: 450 }

interface Live {
  el: HTMLElement
  until: number
  kind: AlertKind
  key: string
}

/**
 * The DOM half. `host` is a fixed, full-window, pointer-transparent layer;
 * the safe area keeps the arrows out from under the chrome.
 */
export class EdgeAlerts {
  private readonly live = new Map<string, Live>()
  private safe = { top: 0, right: 0, bottom: 0, left: 0 }

  constructor(private readonly host: HTMLElement) {}

  setSafeArea(top: number, right: number, bottom: number, left: number): void {
    this.safe = { top, right, bottom, left }
  }

  /**
   * Raise or refresh an alert for an event at world (x, z), if it is off-view.
   * `lane` picks the arrow's colour by whose lane the event was in.
   */
  raise(kind: AlertKind, x: number, z: number, view: ViewBox, lane: number, now: number): void {
    const edge = edgeFor(x, z, view)
    if (!edge) return
    const key = `${kind}:${edge.dx}:${edge.dz}:${lane}`
    let a = this.live.get(key)
    if (!a) {
      const el = document.createElement('div')
      el.className = `alert ${kind}`
      el.dataset.lane = String(lane)
      el.dataset.dx = String(edge.dx)
      el.dataset.dz = String(edge.dz)
      el.textContent = arrowGlyph(edge)
      this.host.appendChild(el)
      a = { el, until: 0, kind, key }
      this.live.set(key, a)
      this.place(a.el, edge)
    }
    // A fresh leak restarts its animation; a refreshed fire just stays lit.
    if (kind === 'leak' && now > a.until) {
      a.el.classList.remove('pulse')
      void a.el.offsetWidth
      a.el.classList.add('pulse')
    }
    a.until = now + ALERT_TTL[kind]
  }

  /** Retire what has expired. Call once a frame. */
  update(now: number): void {
    for (const [key, a] of this.live) {
      if (now <= a.until) continue
      a.el.remove()
      this.live.delete(key)
    }
  }

  /** Re-place every live arrow, after the safe area or the viewport changed. */
  relayout(): void {
    for (const a of this.live.values()) {
      const dx = Number(a.el.dataset.dx) as -1 | 0 | 1
      const dz = Number(a.el.dataset.dz) as -1 | 0 | 1
      this.place(a.el, { dx, dz })
    }
  }

  get count(): number {
    return this.live.size
  }

  private place(el: HTMLElement, edge: Edge): void {
    const s = this.safe
    const st = el.style
    st.top = st.bottom = st.left = st.right = ''
    // Along the lane first: top or bottom edge, centred across the usable
    // width, nudged toward the side when the event is also across.
    if (edge.dz !== 0) {
      if (edge.dz < 0) st.top = `${s.top + 10}px`
      else st.bottom = `${s.bottom + 10}px`
      const shift = edge.dx === 0 ? '50%' : edge.dx < 0 ? '30%' : '70%'
      st.left = `calc(${s.left}px + (100% - ${s.left + s.right}px) * ${shift} / 100%)`
      st.transform = 'translateX(-50%)'
      return
    }
    if (edge.dx < 0) st.left = `${s.left + 10}px`
    else st.right = `${s.right + 10}px`
    st.top = `calc(${s.top}px + (100% - ${s.top + s.bottom}px) / 2)`
    st.transform = 'translateY(-50%)'
  }
}

function arrowGlyph(edge: Edge): string {
  if (edge.dz < 0) return '▲'
  if (edge.dz > 0) return '▼'
  return edge.dx < 0 ? '◀' : '▶'
}
