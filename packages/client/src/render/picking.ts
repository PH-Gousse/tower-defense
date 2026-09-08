import * as THREE from 'three'

/**
 * Screen pixels to ground tiles.
 *
 * Pure maths, no DOM and no scene graph, so it unit-tests headlessly against a
 * known camera pose -- which matters more than it sounds. Picking that is off by
 * half a tile is nearly invisible in a screenshot and completely infuriating to
 * play, and it is exactly the kind of bug that only shows up at the lane edges
 * or at one particular zoom level. A test can hold the camera still and check
 * the corners; an eye cannot.
 *
 * Nothing here uses `THREE.Raycaster`. The raycaster allocates a `Ray` and a
 * `Vector3` per `setFromCamera`, and this runs on every `pointermove` and on
 * every wheel tick inside the zoom-to-cursor path. Intersecting a horizontal
 * plane is two lines of algebra; the allocation is the expensive part.
 */

/** A lane's footprint on the ground plane, in world units. */
export interface LaneLayout {
  /** World x of the lane's x = 0 tile edge. */
  readonly originX: number
  /** World z of the lane's y = 0 tile edge. */
  readonly originZ: number
  /** Tiles across. */
  readonly width: number
  /** Tiles along the lane. */
  readonly length: number
  /** World units per tile. */
  readonly tile: number
}

export interface TileCoord {
  x: number
  y: number
}

/** Reused by `groundUnderNdc`. Never handed to a caller. */
const _origin = new THREE.Vector3()
const _dir = new THREE.Vector3()

/**
 * Client pixels to normalised device coordinates.
 *
 * `rect` is the canvas's bounding box, so this stays correct when the canvas is
 * inset rather than filling the window -- the case that breaks every version of
 * this function written against `innerWidth` directly.
 */
export function ndcFromClient(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  out: THREE.Vector2,
): THREE.Vector2 {
  return out.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
}

/**
 * Cast a ray from an NDC point through the camera onto the plane y = 0.
 *
 * Returns `null` when the ray never reaches the plane: it points at or above
 * the horizon, or the plane lies behind the camera. Both are reachable at a
 * shallow pitch with a wide field of view, and returning a wildly distant point
 * instead of `null` is how a hover highlight ends up several hundred tiles away.
 *
 * The camera's `matrixWorld` and `projectionMatrixInverse` must be current;
 * `CameraRig.applyPose` guarantees that, and tests do it by hand.
 */
export function groundUnderNdc(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  _origin.setFromMatrixPosition(camera.matrixWorld)

  // Unproject a point on the far side of the near plane and aim at it. Both
  // `unproject` steps are matrix multiplies in place -- no allocation.
  _dir.set(ndcX, ndcY, 0.5).unproject(camera).sub(_origin)

  // Parallel to the ground, or aimed away from it.
  if (_dir.y === 0) return null
  const t = -_origin.y / _dir.y
  if (!(t > 0) || !Number.isFinite(t)) return null

  out.set(_origin.x + _dir.x * t, 0, _origin.z + _dir.z * t)
  return out
}

/**
 * The same cast, starting from client pixels. Convenience over the two above.
 */
export function screenToGround(
  camera: THREE.Camera,
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  out: THREE.Vector3,
  ndcScratch: THREE.Vector2,
): THREE.Vector3 | null {
  ndcFromClient(clientX, clientY, rect, ndcScratch)
  return groundUnderNdc(camera, ndcScratch.x, ndcScratch.y, out)
}

/**
 * A ground point to integer tile coordinates within a lane, or `null` outside.
 *
 * `Math.floor`, not rounding: tile (0,0) spans [0,1) on both axes, so a point
 * at exactly 1.0 belongs to tile 1. The half-open interval is what makes the
 * boundary between two tiles unambiguous, and the `< width` comparison is what
 * keeps the far edge -- a point at exactly `width` -- outside the lane rather
 * than in a phantom column one past the end.
 */
export function groundToTile(
  point: { x: number; z: number },
  lane: LaneLayout,
  out: TileCoord,
): TileCoord | null {
  const lx = (point.x - lane.originX) / lane.tile
  const lz = (point.z - lane.originZ) / lane.tile
  if (lx < 0 || lz < 0 || lx >= lane.width || lz >= lane.length) return null
  out.x = Math.floor(lx)
  out.y = Math.floor(lz)
  return out
}
