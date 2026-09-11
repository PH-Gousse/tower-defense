import * as THREE from 'three'

/**
 * The team-colour toon material.
 *
 * The albedo's alpha channel is the team mask (style sheet §6): white where
 * the owner's colour goes, black elsewhere, `alphaMode: OPAQUE` so no
 * loader treats it as transparency. This material reads that channel and
 * mixes the team colour in per texel, on top of MeshToonMaterial's ramp,
 * so the look on a skinned creep and on an InstancedMesh is the same
 * shader with one difference: a single mesh takes the team colour as a
 * uniform, an instanced one takes it from `instanceColor`.
 *
 * Done with `onBeforeCompile` rather than a ShaderMaterial so skinning,
 * instancing, shadows and fog keep working exactly as three.js does them.
 */

export const TEAM_COLOURS: readonly [THREE.Color, THREE.Color] = [new THREE.Color('#4f8cc9'), new THREE.Color('#d0483c')]

/** A three-step toon ramp: shadow, mid, lit. Shared. */
let gradient: THREE.DataTexture | null = null
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient
  const data = new Uint8Array([120, 120, 120, 255, 200, 200, 200, 255, 255, 255, 255, 255])
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat)
  gradient.minFilter = THREE.NearestFilter
  gradient.magFilter = THREE.NearestFilter
  gradient.generateMipmaps = false
  gradient.needsUpdate = true
  return gradient
}

export interface TeamMaterialOptions {
  readonly map: THREE.Texture | null
  readonly instanced: boolean
  readonly team?: 0 | 1
}

export const TEAM_SHADER_TAG = 'ltw-team-mask'

export function teamToonMaterial(o: TeamMaterialOptions): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ map: o.map ?? undefined, gradientMap: toonGradient(), color: 0xffffff })
  const team = { value: TEAM_COLOURS[o.team ?? 0].clone() }
  mat.userData['team'] = team
  mat.userData['instanced'] = o.instanced
  mat.customProgramCacheKey = () => `${TEAM_SHADER_TAG}:${o.instanced ? 'inst' : 'one'}`
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['teamColour'] = team
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 teamColour; // ${TEAM_SHADER_TAG}`)
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  #ifdef USE_INSTANCING_COLOR
    vec3 ltwTeam = vColor.rgb;
  #else
    vec3 ltwTeam = teamColour;
  #endif
  diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, ltwTeam, sampledDiffuseColor.a );
#endif`,
      )
      // The default multiplies diffuse by vColor; for us vColor IS the team colour, already applied above.
      .replace('#include <color_fragment>', '')
  }
  return mat
}

/** Change the team of a non-instanced material in place. */
export function setTeam(mat: THREE.Material, team: 0 | 1): void {
  const u = (mat.userData as { team?: { value: THREE.Color } })['team']
  if (u) u.value.copy(TEAM_COLOURS[team])
}

/** The unlit glow material: emissive only. Shared per colour. */
const glows = new Map<string, THREE.MeshBasicMaterial>()
export function glowMaterial(colour: THREE.Color): THREE.MeshBasicMaterial {
  const key = colour.getHexString()
  let m = glows.get(key)
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: colour })
    glows.set(key, m)
  }
  return m
}

/**
 * Re-material a loaded glTF instance: `body` gets the team toon material,
 * `glow` the emissive one. Returns the body material so the caller can set
 * the team, tint or wireframe it.
 */
export function applyTeamMaterials(root: THREE.Object3D, albedo: THREE.Texture | null, glowColour: THREE.Color | null, team: 0 | 1): THREE.MeshToonMaterial {
  const body = teamToonMaterial({ map: albedo, instanced: false, team })
  const glow = glowColour ? glowMaterial(glowColour) : null
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const replaced = mats.map((m) => (m.name === 'glow' && glow ? glow : body))
    mesh.material = Array.isArray(mesh.material) ? replaced : (replaced[0] as THREE.Material)
  })
  return body
}
