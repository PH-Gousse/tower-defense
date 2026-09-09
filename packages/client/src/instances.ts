import * as THREE from 'three'

/**
 * Instanced meshes that grow with the match instead of with the rule book.
 *
 * The simulation caps a lane at `MAX_CREEPS`, and that number is deliberately
 * sized past anything gold can buy so a player never meets it. The renderer used
 * to take the same number literally and hand the GPU that many instance slots at
 * page load -- one per creep, five more per creep for its lap pips -- which is
 * tens of megabytes of empty buffers on every device, almost always for nothing.
 *
 * They are only the same number by accident. A simulation limit exists so a rule
 * is never hit; a drawing limit exists so a frame can be drawn. Starting small
 * and doubling when a match actually needs it costs a page load what it costs
 * today, and keeps the ceiling the simulation wants.
 *
 * The trade is honest and worth naming: growing reallocates GPU buffers, so the
 * frame that crosses a power of two hitches. It happens at most a handful of
 * times in a match -- twelve doublings covers every creep the cap allows -- and
 * only in matches busy enough to need it.
 */

/** Slots allocated up front. Above any ordinary match, below any real cost. */
export const INITIAL_INSTANCES = 4096

/**
 * Capacity that holds `needed`, doubling from `current`, never past `max`.
 *
 * Returns `current` unchanged when it already fits, so the caller can compare
 * identity and skip the reallocation entirely on the overwhelmingly common tick.
 */
export function nextCapacity(current: number, needed: number, max: number): number {
  if (needed <= current) return current
  if (current >= max) return max
  let next = current > 0 ? current : 1
  while (next < needed && next < max) next *= 2
  return next > max ? max : next
}

/** The slice of a parent this needs, so a test can stand one up without a scene. */
export interface InstanceParent {
  add(child: THREE.Object3D): unknown
  remove(child: THREE.Object3D): unknown
}

/**
 * Grow `mesh` to hold `needed` instances, returning the mesh to draw into.
 *
 * Returns the SAME mesh when it already fits, which is every tick but a few.
 * When it does grow, the old mesh is detached and disposed -- geometry and
 * material are shared with the replacement and deliberately not disposed with
 * it, because they belong to the caller and outlive any one buffer.
 *
 * Instance data is not copied across. Every caller here rewrites all of it from
 * the simulation on the same frame, so copying would be work with no observer.
 */
export function ensureCapacity<G extends THREE.BufferGeometry, M extends THREE.Material>(
  mesh: THREE.InstancedMesh<G, M>,
  needed: number,
  max: number,
  parent: InstanceParent,
): THREE.InstancedMesh<G, M> {
  const current = mesh.instanceMatrix.count
  const capacity = nextCapacity(current, needed, max)
  if (capacity === current) return mesh

  // Generic in geometry and material so the caller keeps its narrow type: the
  // replacement shares both with the mesh it replaces, and the caller's local
  // is reassigned to it.
  const next = new THREE.InstancedMesh<G, M>(mesh.geometry, mesh.material, capacity)
  next.count = 0
  next.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  next.frustumCulled = mesh.frustumCulled
  next.renderOrder = mesh.renderOrder
  parent.remove(mesh)
  parent.add(next)
  mesh.dispose()
  return next
}
