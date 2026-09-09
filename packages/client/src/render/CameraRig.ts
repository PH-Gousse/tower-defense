import * as THREE from 'three'
import { groundUnderNdc, ndcFromClient } from './picking'

/**
 * A fixed high-angle perspective camera, in the Warcraft 3 mould.
 *
 * The whole rig is three numbers plus a point: a target on the ground plane,
 * a pitch, a yaw and a distance. The camera's position is *derived* from those
 * every frame and is never written to directly -- that is the load-bearing
 * rule of this file. Input handlers move the target or the distance and nothing
 * else, so there is exactly one place where a pose can be wrong, and pitch,
 * yaw and roll cannot drift no matter what order events arrive in. This is what
 * separates a fixed camera from an orbit camera that happens to start level.
 *
 *              camera
 *                 \
 *                  \  distance
 *          pitchDeg \
 *        ------------\------------  ground, y = 0
 *                    target
 *
 * ## Which way is up
 *
 * The lane's entrance is at LOW z (`ENTRANCE_ROW = 0` in the sim's grid) and
 * its exit at HIGH z. Points farther from the camera draw higher on screen, so
 * putting the entrance at the top of the screen -- north-is-up, as Warcraft 3
 * frames a map -- means the camera sits at high z and looks toward **-z**.
 * Hence `yawDeg = 0` is a -z gaze. The project spec described the lane the
 * other way round; the screen-space goal is what has been honoured here,
 * because that is the part a player can see.
 *
 * ## Why the fitting maths is short
 *
 * Work in camera space. A ground point at signed offset `s` along the gaze
 * direction from the target, and lateral offset `w`, lands at
 *
 *     x_cam = w        y_cam = s * sin(pitch)        z_cam = d + s * cos(pitch)
 *
 * The height and horizontal setback of the camera cancel exactly, which is why
 * there is no trigonometric solve anywhere below. Everything else -- fitting a
 * rectangle, computing what is visible, clamping the pan -- falls out of those
 * three expressions. See `fitDistance` and `visibleHalfExtents`.
 *
 * This module knows nothing about the simulation. It speaks world units only.
 */

export interface GroundBounds {
  readonly minX: number
  readonly minZ: number
  readonly maxX: number
  readonly maxZ: number
}

export interface CameraRigOptions {
  /** Angle below the horizontal, in degrees. Warcraft 3 sits near 56. */
  pitchDeg?: number
  /** Rotation of the gaze about +y. 0 looks toward -z. Fixed during play. */
  yawDeg?: number
  /** Vertical field of view, in degrees. */
  fovDeg?: number
  distance?: number
  minDistance?: number
  maxDistance?: number
  /** Ground rectangle the view is kept inside. Panning cannot leave it. */
  bounds?: GroundBounds
  /** World units per second for keyboard and edge panning, at `distance`. */
  panSpeed?: number
  /** Multiplier applied per 100 units of wheel delta. */
  zoomSpeed?: number
  /** Pixels from the viewport edge that trigger edge scrolling. 0 disables. */
  edgeSize?: number
  /**
   * Which keys pan.
   *
   * The game binds `q w e r t y` to sending creeps and `d` to saving a match
   * file, so WASD is not the rig's to take there -- `W` would send a creep
   * while walking the camera, and `D` would drop a dump file every time you
   * panned right. `'arrows'` leaves the letter keys alone; `'none'` gives up
   * the keyboard entirely.
   */
  keys?: 'wasd' | 'arrows' | 'none'
}

const DEG = Math.PI / 180

/** Reused every frame. The update path must not allocate. */
const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()
const _ground = new THREE.Vector3()
const _anchor = new THREE.Vector3()
const _ndc = new THREE.Vector2()

/**
 * How far the visible ground reaches, per unit of distance.
 *
 * A tilted camera does not see a rectangle of ground; it sees a trapezoid, and
 * an asymmetric one. Solving `|y_cam| = t * z_cam` for `s` gives the two edges:
 *
 *     s_near = -distance * kn      the bottom of the screen, kn = t/(sinP + t*cosP)
 *     s_far  = +distance * kf      the top of the screen,    kf = t/(sinP - t*cosP)
 *
 * `kf > kn` always, so the top edge is farther from the target than the bottom
 * edge, and the ground is wider up there than it is down here. Treating the
 * window as symmetric -- or taking its width at the near row -- is the mistake
 * that lets a clamped pan walk the lane off the side of the screen.
 *
 * `kf` runs to infinity as the pitch approaches half the field of view, which
 * is the pitch at which the horizon enters frame. It is capped rather than
 * allowed to diverge: past that point there is no finite window to clamp
 * against, and a capped value degrades to "pin to the centre" instead of
 * producing NaN.
 */
const HORIZON_CAP = 50

/**
 * The tuned pose. **Exported because the tests must not re-declare them.**
 *
 * `camera.test.ts` used to carry its own `FOV_DEG = 35` / `PITCH_DEG = 56`
 * copies. That made every camera test green regardless of what the rig actually
 * shipped: narrowing the field of view here would have left a suite asserting
 * the fit, the clamp and the pan travel of a configuration the game no longer
 * used. Importing these is what keeps the tests pointed at the real build.
 *
 * ---
 *
 * **Field of view: 18, from 35, from 45 originally.**
 *
 * Under perspective a lane's near row renders wider than its far row, and this
 * is a game about reading a maze at a glance -- two towers the same distance
 * apart look different distances apart depending where they sit. Measured as
 * the near/far row width ratio at the framing the game opens on (both lanes,
 * 1456x830 viewport, chrome reserved), which is the condition the earlier
 * figures in this file omitted and could not be reproduced without:
 *
 *     fov 45, pitch 56   ratio 1.565    the rig's first pose
 *     fov 35, pitch 56   ratio 1.403    what shipped until now
 *     fov 24, pitch 66   ratio 1.161
 *     fov 18, pitch 70   ratio 1.095    here
 *
 * Orthographic would be 1.000, and was rejected rather than deferred: every one
 * of `factors`, `fitGround` and `screenToGround` is written in terms of
 * `tan(fov/2)`, so an orthographic camera is a rewrite of the picking path, and
 * a misplaced 600g tower cannot be undone for free. 18 buys three quarters of
 * the remaining taper for a two-line change that reverts in one commit.
 *
 * **Pitch: 70, from Warcraft 3's own 56.** Raising it with the fov is what keeps
 * the board filling the frame rather than receding; the two move together.
 *
 * WC3 itself runs a stronger perspective than any of these -- roughly 13 tiles
 * back over 15 tiles of depth. It gets away with that by never framing a whole
 * map at once. This camera has to fit all 24 tiles of a lane, and matching WC3's
 * ratio there leaves the entrance row too small to read.
 */
export const DEFAULT_FOV_DEG = 18
export const DEFAULT_PITCH_DEG = 70

/**
 * Ceiling on how far back the camera may sit.
 *
 * **This constant is tuned to `DEFAULT_FOV_DEG` and must move with it.** A
 * narrower lens has to sit further back to see the same board, and `fitBounds`
 * clamps the fitted distance rather than widening this limit -- deliberately,
 * see the comment there. So a fov change that outgrows this does not throw or
 * warn: it silently renders a cropped board.
 *
 * The binding case is a SHORT viewport, not a typical one. Required distance
 * across the viewports the guard test walks, at fov 18 / pitch 70:
 *
 *     3440x1440    83.1
 *     iPad  820x1180    85.1
 *     iPhone 390x844    89.8
 *     1456x830          90.0
 *     1280x800          90.7
 *     1024x640          95.6
 *     1024x500         103.5   <- binds
 *
 * 115 is that worst case with 10% of headroom. At the previous 70, fov 18 would
 * have cropped every one of these -- the 1456x830 case to 78% of the board.
 * `camera.test.ts` walks the same table and fails if any fit exceeds this.
 */
export const DEFAULT_MAX_DISTANCE = 115

function factors(pitchRad: number, fovRad: number) {
  const t = Math.tan(fovRad / 2)
  const sinP = Math.sin(pitchRad)
  const cosP = Math.cos(pitchRad)
  const kn = t / (sinP + t * cosP)
  const denom = sinP - t * cosP
  const kf = denom > t / HORIZON_CAP ? t / denom : HORIZON_CAP
  return { t, cosP, kn, kf }
}

export interface GroundWindow {
  /** Ground distance from the target to the bottom edge of the screen. */
  readonly near: number
  /** Ground distance from the target to the top edge of the screen. */
  readonly far: number
  /** Half-width at the far edge -- the widest the visible ground ever gets. */
  readonly halfW: number
}

/** The trapezoid of ground the camera can see, measured from the target. */
export function groundWindow(
  distance: number,
  pitchRad: number,
  fovRad: number,
  aspect: number,
): GroundWindow {
  const { t, cosP, kn, kf } = factors(pitchRad, fovRad)
  const near = distance * kn
  const far = distance * kf
  return { near, far, halfW: Math.max(0, t * aspect * (distance + far * cosP)) }
}

/**
 * Distance and framing offset that make a rectangle exactly fill the frustum.
 *
 * `halfW` is measured across the gaze, `halfD` along it. `shift` comes back
 * because the target must NOT sit on the rectangle's centre: the window is
 * asymmetric, so centring the target centres the wrong thing and leaves the
 * rectangle hanging low with dead space above it. `shift` is where the
 * rectangle's centre belongs along the gaze, relative to the target.
 *
 * Being free to shift is also what makes the fit tight. Pinned to the centre,
 * the near edge alone dictates the distance and the camera sits about 20%
 * farther back than it needs to; allowing the shift lets both edges bind at
 * once, which is the difference between a lane that fills the screen and one
 * that floats in the middle of it.
 */
export function fitGround(
  halfW: number,
  halfD: number,
  pitchRad: number,
  fovRad: number,
  aspect: number,
): { distance: number; shift: number } {
  const { t, cosP, kn, kf } = factors(pitchRad, fovRad)
  const span = t * aspect
  const wide = halfW / span

  // Vertical: the two edges must fit between -d*kn and +d*kf.
  const dVertical = (2 * halfD) / (kn + kf)
  // Horizontal: the widest the rectangle may be at its own near edge, given
  // that the near edge cannot be pushed past the far edge's own limit.
  const dHorizontal = (wide + 2 * halfD * cosP) / (1 + kf * cosP)
  const distance = Math.max(dVertical, dHorizontal)

  // Where the rectangle's near edge ends up: as far forward as the horizontal
  // constraint demands, but never past the bottom of the screen.
  const nearEdge = Math.max(-distance * kn, (wide - distance) / cosP)
  return { distance, shift: nearEdge + halfD }
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera

  /** Ground rectangle the view is kept inside. Panning cannot leave it. */
  bounds: GroundBounds

  panSpeed: number
  zoomSpeed: number
  edgeSize: number

  private readonly host: HTMLElement
  private readonly target = new THREE.Vector3(0, 0, 0)

  private _pitchDeg: number
  private _yawDeg: number
  private _distance: number
  minDistance: number
  maxDistance: number

  private aspect = 1
  private viewW = 1
  private viewH = 1

  /** Viewport pixels hidden behind fixed UI. See `setSafeArea`. */
  private safeV = 0
  private safeH = 0

  /** Keys currently held, as a direction accumulator. No allocation per frame. */
  private dragStartX = 0
  private dragStartY = 0
  private keyX = 0
  private keyZ = 0
  private readonly held = new Set<string>()
  private readonly panKeys: ReadonlySet<string>

  /** Pointer state. Drag-panning grabs the ground and keeps it under the cursor. */
  private dragPointer = -1
  private dragging = false
  /**
   * Whether the gesture that just ended actually moved the camera.
   *
   * The app needs this to tell a tap from a drag, and it must be the SAME
   * answer the rig acted on. Letting the app re-derive it from its own pixel
   * threshold is what created a dead zone: a click that drifted past the app's
   * slop but was still judged a tap here did nothing at all -- no tower, no
   * pan, no feedback. One source of truth, read on pointerup.
   *
   * Cleared on the next press rather than on release, because the rig's own
   * release handler runs BEFORE the app's and would otherwise wipe the answer
   * before anyone read it.
   */
  private panned = false
  private pannedPointer = -1
  private readonly dragGrab = new THREE.Vector3()
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pinchDistance = 0

  /** Last mouse position over the canvas, for edge scrolling. */
  private edgeX = -1
  private edgeY = -1
  private edgeActive = false

  /** Cached canvas rect; see `viewportRect`. */
  private readonly rect = { left: 0, top: 0, width: 1, height: 1 }
  private rectDirty = true

  private lastTime = 0
  private disposed = false
  private readonly detach: Array<() => void> = []

  constructor(host: HTMLElement, opts: CameraRigOptions = {}) {
    this.host = host
    this._pitchDeg = opts.pitchDeg ?? DEFAULT_PITCH_DEG
    this._yawDeg = opts.yawDeg ?? 0
    this._distance = opts.distance ?? 40
    this.minDistance = opts.minDistance ?? 14
    this.maxDistance = opts.maxDistance ?? DEFAULT_MAX_DISTANCE
    this.panSpeed = opts.panSpeed ?? 26
    this.zoomSpeed = opts.zoomSpeed ?? 1.18
    this.edgeSize = opts.edgeSize ?? 0
    this.bounds = opts.bounds ?? { minX: -1e6, minZ: -1e6, maxX: 1e6, maxZ: 1e6 }
    this.panKeys = PAN_KEY_SETS[opts.keys ?? 'wasd']

    this.camera = new THREE.PerspectiveCamera(opts.fovDeg ?? DEFAULT_FOV_DEG, 1, 0.5, 500)
    this.camera.up.set(0, 1, 0)

    this.bind()
    this.applyPose()
  }

  // --- tunables ------------------------------------------------------------
  // Setters rather than plain fields because every one of them invalidates the
  // derived pose, and lil-gui writes them directly. A tunable that needs the
  // caller to remember to re-apply is a tunable that will be left stale.

  get pitchDeg(): number { return this._pitchDeg }
  set pitchDeg(v: number) { this._pitchDeg = v; this.clampTarget(); this.applyPose() }

  get yawDeg(): number { return this._yawDeg }
  set yawDeg(v: number) { this._yawDeg = v; this.clampTarget(); this.applyPose() }

  get fovDeg(): number { return this.camera.fov }
  set fovDeg(v: number) {
    this.camera.fov = v
    this.camera.updateProjectionMatrix()
    this.clampTarget()
    this.applyPose()
  }

  get distance(): number { return this._distance }
  set distance(v: number) {
    this._distance = clamp(v, this.minDistance, this.maxDistance)
    this.clampTarget()
    this.applyPose()
  }

  /** The ground point the camera is centred on. Copied out, not aliased. */
  getTarget(out: THREE.Vector3): THREE.Vector3 { return out.copy(this.target) }

  // --- public API ----------------------------------------------------------

  setTarget(x: number, z: number): void {
    this.target.set(x, 0, z)
    this.clampTarget()
    this.applyPose()
  }

  /** Move the target across the ground plane by a world-space delta. */
  pan(dx: number, dz: number): void {
    this.target.x += dx
    this.target.z += dz
    this.clampTarget()
    this.applyPose()
  }

  /**
   * Scale the distance by `factor`, optionally keeping a screen point fixed.
   *
   * With `clientX`/`clientY` given, the ground point under the cursor is held
   * still: zoom moves the world toward the pointer rather than toward the
   * centre of the screen. Done the obvious way -- sample the ground point,
   * change the distance, sample again, and shift the target by the difference.
   *
   * The clamp runs afterwards and outranks the anchor. On an axis where the
   * view is already wider than `bounds` the target is pinned and the point
   * under the cursor does move -- there is no position that both honours the
   * anchor and keeps the lanes on screen, and keeping them on screen wins.
   */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const anchored =
      clientX !== undefined &&
      clientY !== undefined &&
      this.groundAt(clientX, clientY, _anchor) !== null

    const before = this._distance
    this._distance = clamp(before * factor, this.minDistance, this.maxDistance)
    if (this._distance === before) return
    this.applyPose()

    if (anchored) {
      // `_anchor` holds where the cursor pointed before; `_ground` where the
      // same pixel points now. Shifting by the difference pins it in place.
      if (this.groundAt(clientX as number, clientY as number, _ground) !== null) {
        this.target.x += _anchor.x - _ground.x
        this.target.z += _anchor.z - _ground.z
      }
    }
    this.clampTarget()
    this.applyPose()
  }

  /**
   * Frame a ground rectangle: back off until it fits, and sit where it centres.
   *
   * The target deliberately does not land on the rectangle's centre. See
   * `fitGround` -- the visible trapezoid is asymmetric, so the target has to sit
   * forward of centre for the rectangle to look centred on screen.
   */
  fitBounds(minX: number, minZ: number, maxX: number, maxZ: number, margin = 1.06): void {
    const cx = (minX + maxX) / 2
    const cz = (minZ + maxZ) / 2

    // Half-extents of the rectangle measured in the camera's frame, so a
    // non-zero yaw still fits. At yaw 0 this is just the rectangle itself.
    this.axes()
    let halfW = 0
    let halfD = 0
    for (let i = 0; i < 4; i++) {
      const px = (i & 1 ? maxX : minX) - cx
      const pz = (i & 2 ? maxZ : minZ) - cz
      const w = Math.abs(px * _right.x + pz * _right.z)
      const s = Math.abs(px * _forward.x + pz * _forward.z)
      if (w > halfW) halfW = w
      if (s > halfD) halfD = s
    }

    // Fit into the part of the viewport that is not behind fixed UI. Shrinking
    // the usable box is equivalent to narrowing the frustum, so it is expressed
    // as an effective field of view and aspect rather than as a second code
    // path through the fitting maths.
    const usableY = Math.max(0.2, (this.viewH - 2 * this.safeV) / this.viewH)
    const usableX = Math.max(0.2, (this.viewW - 2 * this.safeH) / this.viewW)
    const t = Math.tan((this.camera.fov * DEG) / 2)
    const fovEff = 2 * Math.atan(t * usableY)
    const aspectEff = (this.aspect * usableX) / usableY

    const fit = fitGround(
      halfW * margin,
      halfD * margin,
      this._pitchDeg * DEG,
      fovEff,
      aspectEff,
    )
    // The clamp is honoured rather than bypassed: a fit that needs more room
    // than maxDistance allows should show the user the clamped view, not
    // silently widen a limit the rest of the rig relies on.
    this._distance = clamp(fit.distance, this.minDistance, this.maxDistance)
    // rectCentre = target + forward * shift, so the target sits back from it.
    this.target.set(cx - _forward.x * fit.shift, 0, cz - _forward.z * fit.shift)
    this.clampTarget()
    this.applyPose()
  }

  /**
   * Advance keyboard and edge panning. Call once a frame.
   *
   * `dt` is seconds; omitted, it is measured from the wall clock and capped, so
   * a backgrounded tab that resumes after ten seconds does not fling the camera
   * across the map in one step.
   */
  update(dt?: number): void {
    const now = performance.now()
    let step = dt
    if (step === undefined) {
      step = this.lastTime === 0 ? 1 / 60 : (now - this.lastTime) / 1000
    }
    this.lastTime = now
    if (step > 0.1) step = 0.1

    let dx = this.keyX
    let dz = this.keyZ

    if (this.edgeSize > 0 && this.edgeActive) {
      if (this.edgeX >= 0 && this.edgeX < this.edgeSize) dx -= 1
      else if (this.edgeX > this.viewW - this.edgeSize && this.edgeX <= this.viewW) dx += 1
      if (this.edgeY >= 0 && this.edgeY < this.edgeSize) dz += 1
      else if (this.edgeY > this.viewH - this.edgeSize && this.edgeY <= this.viewH) dz -= 1
    }

    if (dx === 0 && dz === 0) return

    // Pan speed scales with distance so a keypress covers the same fraction of
    // the screen zoomed in as zoomed out. A fixed world-unit speed crawls when
    // zoomed out and overshoots when zoomed in.
    const scale = (this.panSpeed * step * this._distance) / 32
    const len = Math.hypot(dx, dz)
    this.axes()
    // Screen-relative: "up" walks along the gaze, "right" across it.
    this.pan(
      ((_right.x * dx + _forward.x * dz) / len) * scale,
      ((_right.z * dx + _forward.z * dz) / len) * scale,
    )
  }

  dispose(): void {
    this.disposed = true
    for (const off of this.detach) off()
    this.detach.length = 0
    this.held.clear()
    this.pointers.clear()
  }

  /**
   * Declare how much of the viewport is covered by fixed UI, in CSS pixels.
   *
   * The canvas fills the window, but a HUD band across the top and a palette
   * across the bottom sit on top of it. `fitBounds` has to frame into what is
   * actually visible, or the first and last rows of the board -- the entrance
   * and the exit, the two rows a player most needs to see -- end up behind the
   * chrome. In this game that is 12% of the height, which is far too much to
   * absorb into a fudged margin.
   *
   * Each axis reserves twice the LARGER of its two insets, symmetrically. That
   * costs a few pixels against a lopsided pair of bars, and in exchange the
   * content stays centred on the screen -- so no offset has to be threaded
   * through the fit, the clamp and the zoom anchor, each of which would be a
   * place for the framing to drift out of agreement with itself.
   *
   * The caller re-frames afterwards; this only records the reservation.
   */
  setSafeArea(top: number, right: number, bottom: number, left: number): void {
    this.safeV = Math.max(0, top, bottom)
    this.safeH = Math.max(0, left, right)
  }

  /** Called by the resize hub. Keeps aspect, projection and clamp in step. */
  setViewport(width: number, height: number): void {
    this.viewW = width
    this.viewH = height
    this.rectDirty = true
    this.aspect = height > 0 ? width / height : 1
    this.camera.aspect = this.aspect
    this.camera.updateProjectionMatrix()
    this.clampTarget()
    this.applyPose()
  }

  /** True once `dispose` has run. Useful in tests and teardown assertions. */
  get isDisposed(): boolean { return this.disposed }

  // --- derived pose --------------------------------------------------------

  /** Fill `_forward` and `_right` with the gaze basis on the ground plane. */
  private axes(): void {
    const y = this._yawDeg * DEG
    _forward.set(Math.sin(y), 0, -Math.cos(y))
    _right.set(Math.cos(y), 0, Math.sin(y))
  }

  /**
   * The only place `camera.position` is written.
   *
   * Position and orientation are both recomputed from the target, pitch, yaw
   * and distance, so roll is structurally zero and the pose cannot accumulate
   * error across frames.
   */
  private applyPose(): void {
    const p = this._pitchDeg * DEG
    const horizontal = Math.cos(p) * this._distance
    const vertical = Math.sin(p) * this._distance
    this.axes()
    this.camera.position.set(
      this.target.x - _forward.x * horizontal,
      vertical,
      this.target.z - _forward.z * horizontal,
    )
    // `lookAt` uses three's module-level scratch objects, so this allocates
    // nothing. `up` is +y and the gaze is never vertical, hence zero roll.
    this.camera.lookAt(this.target.x, 0, this.target.z)
    this.camera.updateMatrixWorld()
  }

  /**
   * Hold the view over `bounds`, with room to move.
   *
   * Two rules were tried before this one and both are wrong at one end.
   *
   * Requiring the whole visible trapezoid to sit inside the rectangle is the
   * strict reading, and it made the map immovable, because the default framing
   * already shows the content plus its margin. Measured against the game's own
   * bounds it left 0.56 tiles of travel up and down and NONE left or right, at
   * 1920x1080, 1440x900 and 1000x800 alike -- a quarter of a tile per arrow
   * press before it stopped. The input was wired correctly the whole time.
   *
   * Clamping the target into the rectangle instead gives travel everywhere and
   * gives too much: at the default framing the view is more than twice as wide
   * as the content, so panning to a corner parks both boards in the corner of
   * the screen with two thirds of it empty.
   *
   * So: the strict range, widened by a fraction of the view. Where the strict
   * range exists the player can still reach every part of the content and now
   * push a little past its edge, which is what lets a corner tile sit at the
   * middle of the screen. Where it does not -- zoomed out, everything already
   * visible -- it collapses to the centre and the overscroll is the whole of
   * the travel, bounded so the boards stay near the middle of the view instead
   * of sliding off it.
   */
  private clampTarget(): void {
    const { near, far, halfW } = groundWindow(
      this._distance,
      this._pitchDeg * DEG,
      this.camera.fov * DEG,
      this.aspect,
    )
    this.axes()
    // World-axis bounding box of the visible trapezoid, as offsets from the
    // target. The lateral term is symmetric; the forward one is not, which is
    // the whole reason this is not a pair of half-widths.
    const fx = _forward.x
    const fz = _forward.z
    const wx = halfW * Math.abs(_right.x)
    const wz = halfW * Math.abs(_right.z)
    const loX = -wx + Math.min(-near * fx, far * fx)
    const hiX = wx + Math.max(-near * fx, far * fx)
    const loZ = -wz + Math.min(-near * fz, far * fz)
    const hiZ = wz + Math.max(-near * fz, far * fz)

    this.target.x = clampWindow(this.target.x, this.bounds.minX, this.bounds.maxX, loX, hiX)
    this.target.z = clampWindow(this.target.z, this.bounds.minZ, this.bounds.maxZ, loZ, hiZ)
  }

  /**
   * The canvas's position on screen, cached.
   *
   * `getBoundingClientRect` allocates a `DOMRect` and, worse, forces the
   * browser to flush pending layout to answer. Calling it from `pointermove`
   * and from every wheel tick -- which is what the picking path does -- puts
   * both costs squarely on the frame budget. The rect only moves when the
   * window resizes or the page scrolls, so it is read then and cached here.
   */
  get viewportRect(): { left: number; top: number; width: number; height: number } {
    if (this.rectDirty) {
      const r = this.host.getBoundingClientRect()
      this.rect.left = r.left
      this.rect.top = r.top
      this.rect.width = r.width
      this.rect.height = r.height
      this.rectDirty = false
    }
    return this.rect
  }

  /**
   * Did the gesture on this pointer move the camera?
   *
   * Read it on `pointerup` to tell a tap from a drag. True means the rig
   * consumed the gesture as a pan and the app should not treat it as a click.
   */
  didPan(pointerId: number): boolean {
    return this.panned && this.pannedPointer === pointerId
  }

  /** Ground point under a client pixel, or null when the ray misses y = 0. */
  private groundAt(clientX: number, clientY: number, out: THREE.Vector3): THREE.Vector3 | null {
    ndcFromClient(clientX, clientY, this.viewportRect, _ndc)
    return groundUnderNdc(this.camera, _ndc.x, _ndc.y, out)
  }

  // --- input ---------------------------------------------------------------

  private bind(): void {
    const el = this.host
    const on = (
      t: HTMLElement | Window,
      type: string,
      fn: (ev: never) => void,
      opts?: AddEventListenerOptions,
    ): void => {
      t.addEventListener(type, fn as EventListener, opts)
      this.detach.push(() => t.removeEventListener(type, fn as EventListener, opts))
    }

    on(el, 'pointerdown', (ev: PointerEvent) => {
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY })
      // A new gesture: whatever the last one did is no longer the answer.
      this.panned = false
      this.pannedPointer = -1

      if (ev.pointerType === 'touch') {
        if (this.pointers.size === 2) {
          this.pinchDistance = this.touchSpread()
          this.dragging = false
          return
        }
        if (this.pointers.size > 2) return
      } else if (ev.button !== 0 && ev.button !== 1 && ev.button !== 2) {
        return
      }

      if (this.groundAt(ev.clientX, ev.clientY, this.dragGrab) === null) return
      this.dragging = true
      this.dragPointer = ev.pointerId
      this.dragStartX = ev.clientX
      this.dragStartY = ev.clientY
      // Throws NotFoundError if the pointer is no longer active -- which a
      // synthetic event always is, and a real one can be if the button came up
      // between the event being queued and this handler running. Losing capture
      // costs a drag that stops at the canvas edge; letting it throw would
      // abort the handler and leave the drag half-started.
      try { el.setPointerCapture(ev.pointerId) } catch { /* not capturable */ }
      ev.preventDefault()
    })

    on(el, 'pointermove', (ev: PointerEvent) => {
      const tracked = this.pointers.get(ev.pointerId)
      if (tracked) {
        tracked.x = ev.clientX
        tracked.y = ev.clientY
      }

      if (ev.pointerType !== 'touch') {
        this.edgeX = ev.clientX
        this.edgeY = ev.clientY
        this.edgeActive = true
      }

      // Pinch takes priority: two fingers down is never a pan.
      if (this.pointers.size === 2 && ev.pointerType === 'touch') {
        const spread = this.touchSpread()
        if (this.pinchDistance > 0 && spread > 0) {
          const mx = this.touchMidX()
          const my = this.touchMidY()
          this.zoomBy(this.pinchDistance / spread, mx, my)
        }
        this.pinchDistance = spread
        return
      }

      if (!this.dragging || ev.pointerId !== this.dragPointer) return

      // Nothing moves until the pointer has travelled DRAG_SLOP pixels.
      //
      // This is what lets the left button both place a tower and drag the map,
      // which an earlier version could not: it had one threshold here and a
      // different one deciding whether a release was a build, and a press that
      // drifted between the two placed nothing and panned nothing. There is one
      // threshold now and one answer, `didPan`, and the app asks it rather than
      // measuring the gesture a second time. Middle and right have no click
      // action to protect, but they cross four pixels in the first moved frame
      // of any real drag, so they pay nothing for sharing the path.
      if (!this.panned) {
        const moved = Math.hypot(ev.clientX - this.dragStartX, ev.clientY - this.dragStartY)
        if (moved < DRAG_SLOP) return
        // Re-grab here rather than from the press point, or the view would jump
        // by the slop the instant the drag starts.
        if (this.groundAt(ev.clientX, ev.clientY, this.dragGrab) === null) return
        this.panned = true
        this.pannedPointer = ev.pointerId
        ev.preventDefault()
        return
      }

      // Grab-and-drag: keep the ground point the gesture started on under the
      // pointer. Deriving the delta from screen pixels instead would drift,
      // because a pixel is worth more world units at the top of a tilted view
      // than at the bottom.
      if (this.groundAt(ev.clientX, ev.clientY, _ground) === null) return
      this.pan(this.dragGrab.x - _ground.x, this.dragGrab.z - _ground.z)
      // Re-sample: the clamp may have refused part of that move, and carrying
      // the original grab point forward would make the camera lurch when the
      // pointer comes back off the edge.
      if (this.groundAt(ev.clientX, ev.clientY, _ground) !== null) this.dragGrab.copy(_ground)
      ev.preventDefault()
    })

    const endPointer = (ev: PointerEvent): void => {
      this.pointers.delete(ev.pointerId)
      if (this.pointers.size < 2) this.pinchDistance = 0
      if (ev.pointerId === this.dragPointer) {
        this.dragging = false
        this.dragPointer = -1
        try { el.releasePointerCapture(ev.pointerId) } catch { /* never captured */ }
      }
    }
    on(el, 'pointerup', endPointer)
    on(el, 'pointercancel', endPointer)

    on(el, 'pointerleave', (ev: PointerEvent) => {
      if (ev.pointerType !== 'touch') this.edgeActive = false
    })

    // Right-drag is a pan, so the context menu has to go, or every pan ends in
    // a menu popping up over the lane.
    on(el, 'contextmenu', (ev: Event) => ev.preventDefault())

    on(
      el,
      'wheel',
      (ev: WheelEvent) => {
        ev.preventDefault()
        this.zoomBy(Math.pow(this.zoomSpeed, ev.deltaY / 100), ev.clientX, ev.clientY)
      },
      { passive: false },
    )

    on(window, 'keydown', (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!this.panKeys.has(ev.code)) return
      this.held.add(ev.code)
      this.recomputeKeys()
      ev.preventDefault()
    })

    on(window, 'keyup', (ev: KeyboardEvent) => {
      if (!this.held.delete(ev.code)) return
      this.recomputeKeys()
    })

    // Scrolling moves the canvas under the pointer without resizing it, so the
    // cached rect has to be invalidated here as well as on resize.
    on(window, 'scroll', () => { this.rectDirty = true }, { passive: true } as AddEventListenerOptions)

    // A tab switch swallows the keyup, and the camera would drift forever.
    on(window, 'blur', () => {
      this.held.clear()
      this.recomputeKeys()
      this.dragging = false
      this.edgeActive = false
      this.pointers.clear()
    })
  }

  private recomputeKeys(): void {
    let x = 0
    let z = 0
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) x -= 1
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) x += 1
    // Up walks along the gaze, toward the top of the screen.
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) z += 1
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) z -= 1
    this.keyX = x
    this.keyZ = z
  }

  private touchSpread(): number {
    const it = this.pointers.values()
    const a = it.next().value
    const b = it.next().value
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  private touchMidX(): number {
    const it = this.pointers.values()
    const a = it.next().value
    const b = it.next().value
    return a && b ? (a.x + b.x) / 2 : this.viewW / 2
  }

  private touchMidY(): number {
    const it = this.pointers.values()
    const a = it.next().value
    const b = it.next().value
    return a && b ? (a.y + b.y) / 2 : this.viewH / 2
  }
}

const ARROW_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const

/**
 * How far past the strict limit the camera may be pushed, as a fraction of the
 * view's own half-size on that axis.
 *
 * A quarter. It is the number that decides whether the map feels movable, so it
 * is stated as a fraction of the view rather than in tiles: a quarter of a
 * screen of travel reads the same zoomed in as zoomed out, where a fixed tile
 * count would be a shove at one end and a twitch at the other. At the game's
 * default desktop framing it buys about 6.4 tiles of travel sideways and 3.2 up
 * and down, against 0 and 0.56 without it.
 */
export const OVERSCROLL = 0.25

/**
 * Clamp a target coordinate so the view stays over the bounds, plus overscroll.
 *
 * `offLo`/`offHi` are the view's extent either side of the target on this axis,
 * which is asymmetric under a tilted camera -- the far edge is both further
 * away and wider than the near one. Where the view is larger than the bounds
 * the strict range inverts; that collapses to the centre rather than being left
 * inside out, so the two cases meet continuously and a scroll across the
 * crossover does not lurch.
 */
export function clampWindow(v: number, lo: number, hi: number, offLo: number, offHi: number): number {
  let a = lo - offLo
  let c = hi - offHi
  if (a > c) {
    const mid = (a + c) / 2
    a = mid
    c = mid
  }
  const slack = OVERSCROLL * ((offHi - offLo) / 2)
  return clamp(v, a - slack, c + slack)
}

/**
 * How far a press may drift and still count as a click, in CSS pixels.
 *
 * Four, not the ten or twelve a pure map would use: the left button places a
 * tower on a one-tile target, so a threshold generous enough to swallow real
 * hand tremor is also generous enough to swallow a deliberate short drag. Four
 * survives the shake of a click on every mouse tested and starts dragging
 * before the pointer has crossed half a tile.
 */
const DRAG_SLOP = 4

const PAN_KEY_SETS: Record<'wasd' | 'arrows' | 'none', ReadonlySet<string>> = {
  wasd: new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', ...ARROW_KEYS]),
  arrows: new Set(ARROW_KEYS),
  none: new Set(),
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

