/* Generated from art/spec.schema.json by `pnpm spec-types`. Do not edit. */

/**
 * One asset, fully described. Everything needed to regenerate it from art/generators at a commit. Fields not listed here are rejected. Every field has a default except id, class, archetype and source.
 */
export interface AssetSpec {
  /**
   * Format version of this file. Bumped when a field changes meaning; the resolver refuses a version it does not know.
   */
  spec_version?: number
  /**
   * The asset id: the filename, the manifest key, the glTF scene name and the TypeScript identifier. Never changes.
   */
  id: string
  /**
   * Asset class. Decides the budget row, the required clips and the id pattern.
   */
  class: 'creep' | 'tower' | 'projectile' | 'effect' | 'tile' | 'prop'
  /**
   * The game archetype (swarm, runner, tank; single, splash, slow) or, for the other classes, a free label used in lineups.
   */
  archetype: string
  /**
   * Creep tier 1 to 3. Tier 1 is the sim's tier index 0.
   */
  tier?: number
  /**
   * Tower level 1 to 3.
   */
  level?: number
  /**
   * Id of the spec this one inherits from. Inheritance is a deep merge: objects merge key by key, scalars and arrays in this spec replace the parent's. Chains resolve recursively; cycles are an error.
   */
  derived_from?: string
  /**
   * A body plan from art/generators/registry.json, or "imported" for an external model.
   */
  body_plan?: string
  /**
   * Body-plan parameters. Names, defaults and ranges come from the registry; spec-validate checks them. `parts` is the list of part-library pieces to attach, each a name or {part, at, scale}.
   */
  params?: {
    parts?: (
      | string
      | {
          part: string
          /**
           * Attachment point name; the part's default when omitted.
           */
          at?: string
          scale?: number
          /**
           * Palette role the part is painted with: primary, secondary, accent, glow or trim.
           */
          palette?: 'primary' | 'secondary' | 'accent' | 'glow' | 'trim'
        }
    )[]
  }
  /**
   * Colour roles, each a palette name from the style sheet (or an alias like creep_skin_2).
   */
  palette?: {
    primary?: string
    secondary?: string
    accent?: string
    /**
     * Emissive colour for glow-slot geometry (eyes, crystals). Null for none.
     */
    glow?: string | null
    /**
     * Fraction the primary is blended toward the accent. The style sheet's tier language sets 0 / 0.25 / 0.5.
     */
    tier_shift?: number
    /**
     * Whether the gold tier-3 trim and emissive strip are present.
     */
    trim?: boolean
    /**
     * Material slots painted white in the team-colour mask. Slot names come from the body plan and parts.
     */
    team_mask?: string[]
  }
  /**
   * Rig template from the registry, or null for an unrigged asset (projectiles, effects, tiles, props).
   */
  rig?: string | null
  /**
   * Clip name (from the animation contract) to the animation generator that produces it, with its parameters.
   */
  animations?: {
    [k: string]: {
      gen: string
      /**
       * Seconds. The generator's default when omitted.
       */
      duration?: number
      /**
       * Walk only: tiles covered per cycle if the creature moved, for the client's timeScale.
       */
      stride?: number
      /**
       * Normalised times of contract markers (fire, land, impact).
       */
      markers?: {
        [k: string]: number
      }
    }
  }
  /**
   * Event name to sound id. Events not listed fall back to the archetype's default in the binding table.
   */
  audio?: {
    [k: string]: string
  }
  /**
   * PROPOSED game-data entry. Never applied by the factory; handed to /rule-change. Free-form, keyed like the constants file.
   */
  game?: {
    [k: string]: unknown
  }
  /**
   * Only when body_plan is "imported": where the external model is and how to bring it to the conventions.
   */
  import?: {
    /**
     * Path under art/source/ (.glb, .gltf, .fbx, .blend).
     */
    file?: string
    /**
     * Multiplier applied before fitting to the class's height range. 0 means fit automatically.
     */
    scale?: number
    /**
     * Which axis of the source file faces forward.
     */
    forward?: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
    up?: '+y' | '+z'
    /**
     * Rig template to retarget the file's own clips onto, or null to bake procedural clips from `animations` onto the file's rig.
     */
    retarget?: string | null
    /**
     * Source clip name to contract clip name, for files that carry their own animation.
     */
    clip_map?: {
      [k: string]: string
    }
  }
  /**
   * Provenance and licence. Required; the gate refuses a build without it.
   */
  source: {
    kind: 'generated' | 'pack' | 'ai' | 'freelance' | 'hand'
    licence: 'own' | 'cc0' | 'cc-by' | 'other'
    author?: string
    url?: string
    /**
     * Required for cc-by: the exact line that goes in LICENSES.md.
     */
    attribution?: string
    /**
     * For ai and paid sources: the service or vendor.
     */
    service?: string
    /**
     * For ai, paid and other: a pointer to the terms.
     */
    terms?: string
    /**
     * Required before an ai, freelance or other-licence asset ships.
     */
    approved_by?: string
    approved_on?: string
    notes?: string
  }
}
