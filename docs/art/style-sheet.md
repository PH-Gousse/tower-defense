# Style sheet

Binding for every source of assets: the generator library, an imported CC0 model, a
freelancer, an AI generator. The gate (`asset-gate`) enforces the parts of this that a
script can check; the art-director critique checks the rest. Anything tagged `[proposed]`
is a placeholder awaiting confirmation, like the GDD's.

Where this file and `docs/gdd.md` disagree, the GDD wins on rules and this file wins on
looks. Where this file and the code disagree, the code is the bug.

---

## 1. Look

**Stylised low-poly, flat/toon shading, chunky proportions, strong silhouettes, saturated
palette.** No realistic PBR: no roughness or metalness maps, no normal maps, no
image-based lighting. Every surface is a flat colour from the palette with baked ambient
occlusion and a vertical gradient in a single albedo texture. Lighting in the client is one
warm sun, one hemisphere fill and a toon ramp, and a model must read under exactly that.

Rules of thumb the critique applies:

- **One idea per asset.** A runner is *fast*. A tank is *heavy*. A splash tower *lobs*. If
  the asset needs a caption, it fails.
- **Proportions are chunky.** Heads, hands, feet, barrels, crystals are all oversized.
  Thin parts (tails, antennae, spikes) are thicker than nature and short enough not to
  vanish at game distance.
- **No small detail.** Anything under about 6 cm in world units (0.06) is invisible at
  the game camera and costs triangles for nothing. Detail lives in silhouette and in
  colour blocks, not in surface texture.
- **Colour is blocked, never blended.** Two or three palette colours per asset, hard
  edges between them. The gradient and AO bake is the only soft shading.
- **Nothing from Warcraft.** No Warcraft 3 asset, unit name, design, colour scheme or
  recognisable look-alike, ever, including in `art/references/`. The camera and the
  *game* descend from that map; the art does not.

## 2. Camera distance

Assets are read from the fixed high-angle camera (ADR-0014). The numbers in code:

| | Value | Where |
|---|---|---|
| Field of view | 18° vertical | `DEFAULT_FOV_DEG`, `CameraRig.ts` |
| Pitch | 70° below horizontal | `DEFAULT_PITCH_DEG` |
| Yaw | 0, fixed; the camera looks toward −z | `CameraRig.ts` |
| Fitted distance, both lanes | ≈ 71 units | `fitGround` at the shipped pose; the 24-tile lane length is the binding edge at every aspect ratio |
| Zoom range | 16 to 115 units | `minDistance` in `scene.ts`, `DEFAULT_MAX_DISTANCE` |

At the fitted distance on a 1080p screen, one world unit is about 48 px tall. So:

| Asset | Height (units) | On screen at default zoom |
|---|---|---|
| Swarm creep, tier 1 | 0.36 | ≈ 17 px |
| Runner creep, tier 1 | 0.55 | ≈ 26 px |
| Tank creep, tier 1 | 1.05 | ≈ 50 px |
| Tower, level 1 | 1.1 to 1.4 | ≈ 55 to 65 px |

This is why the silhouette test in §4 runs at a **normalised** 32 px and separately at true
game scale: a swarm creep can never be 32 px tall at the default zoom, and the test must
not pretend otherwise.

**Reference frame:** `reports/art/reference/game-camera.png` — rendered by `asset-preview`
from the real pose once the first asset exists. Every preview turntable uses the same pose.

## 3. Palette `[proposed]`

Sixteen base colours plus the two team colours. Generators, materials and the critique refer
to colours **by name only**; the hex value lives here and in
`art/generators/ltw_art/palette.py` (kept in sync by a test).

| Name | Hex | Role |
|---|---|---|
| `stone` | `#8f9399` | tower masonry, rock |
| `stone_dark` | `#5f646b` | plinths, shadow blocks, kerbs |
| `stone_blue` | `#7d8aa0` | the slow tower's cold masonry |
| `wood` | `#6e4a29` | roofs, shafts, handles |
| `wood_dark` | `#4a301a` | clubs, posts, trunks |
| `iron` | `#3c3f45` | bands, shot, arrowheads, dark limbs |
| `bronze` | `#b8813f` | barrels, fittings |
| `gold` | `#e2b64a` | tier-3 and level-3 trim; nothing else may use it |
| `bone` | `#e8dcc0` | tusks, teeth, fletching, pale highlights |
| `moss` | `#3f7f2c` | swarm creep skin (`creep_skin_1`) |
| `tawny` | `#b0844c` | runner creep skin (`creep_skin_2`) |
| `umber` | `#9a6a48` | tank creep skin (`creep_skin_3`) |
| `venom` | `#7ccf5a` | swarm accent, poison, sickly glow |
| `danger` | `#ff5a3c` | runner accent, eyes, warnings, leak marker |
| `violet` | `#b48ce0` | tank accent, tier-3 shift |
| `ice` | `#a9e6ff` | frost glow, slow effect; `ice_deep` `#5cc3ef` is its shadow |

Team colours, applied **only** through the team-colour mask (§6), never painted directly:

| Name | Hex | |
|---|---|---|
| `team_blue` | `#4f8cc9` | player 0 |
| `team_red` | `#d0483c` | player 1 |

Aliases the specs use: `creep_skin_1..3` → `moss`, `tawny`, `umber`.

The turf, kerb and HUD colours are outside this palette on purpose: they are the *ground*
the assets are read against and are owned by `board.ts` and `index.html`.

## 4. Silhouette rules per archetype `[proposed]`

Every creep and tower archetype must be identifiable **in flat black at 32 px height**, from
the game camera pitch and from the side. `asset-preview` renders both; the critique fails
an asset whose silhouette could be mistaken for another archetype's.

| Archetype | Silhouette | Must never |
|---|---|---|
| **Swarm** creep | small, low, wide, many-legged; longer than tall | stand upright; be alone in its own lineup render (it is always shown ×5) |
| **Runner** creep | lean, long, low head, forward-leaning; horizontal line **from the side** | have a wide body; read as a tank at 32 px |
| **Tank** creep | wide, heavy, upright; a block with a head, wider at the shoulders than the hips | be lean; have a thin waist |
| **Single-target** tower | tall and thin; height ≥ 2.5 × width | have a wide top |
| **Splash** tower | squat and wide; height ≤ 1.2 × width, a barrel pitched at the sky | be tall |
| **Slow** tower | medium height with a **visible emitter**: a crystal cluster or a spire that glows | look like a plain block |
| **Projectile** | one readable shape: a bolt is a line, a shell is a dot, an orb is a soft disc | carry detail |

The silhouette test renders the game pitch, the side and the front. A creep walks **away**
from the fixed camera for most of a lap, so from the game pitch a long runner foreshortens
into a vertical bar and reads no different from a tall tank at 32 px. That is the camera,
not the model: the archetype rules above are judged on the side and front tiles, and the
game-pitch tile is judged for readability (is it a creature, is it moving) rather than
archetype. Open question: whether the runner archetype needs a top-down signature (a
colour, a trail, a pip) the silhouette cannot give it. `[proposed]`

Creep heights at tier 1 are those already in the game: swarm 0.36, runner 0.55, tank 1.05
units. A tower's footprint stays inside 0.84 × 0.84 of its 1 × 1 tile so the maze's
corridors stay visible; height 1.1 to 1.9 units by level.

## 5. Tier language `[proposed]`

Tier 2 and tier 3 (and tower levels 2 and 3) read as **more of the same thing**, never as a
new thing. The silhouette rule is unchanged; the reading is layered:

| Layer | Tier / level 1 | 2 | 3 |
|---|---|---|---|
| Size | 1.00 | 1.10 | 1.20 |
| Parts | none | one part from the library on a primary attachment point (shoulder plates, a spike row, a second barrel) | the tier-2 part plus one more, on a secondary point (crest, banner, crystal cluster) |
| Palette | `primary` | `primary` blended 15 % toward the archetype's `accent` | 30 % toward `accent` |
| Trim | none | none | `gold` trim on one edge and an emissive strip in the accent colour |

The palette row started at 25 % / 50 % and was brought down after the first catalogue: at
50 % the tier-3 tank read as a new creature (brown to purple) rather than more of the same
one, which is the opposite of what the row is for. 15 % / 30 % is what shipped; the runner
sits at 35 % at tier 3 because its accent is close to its skin. Still `[proposed]`.

The size row replaces the code's current 1 + 0.22 × tier (1.00 / 1.22 / 1.44), which was
sized to make tiers readable with **no** other tier language; once parts and trim carry the
reading, +22 % per tier crowds the lane. This is a client-side constant and does not touch
the sim, but it is a visible change and is `[proposed]` for that reason.

Naming: an asset id's `t1` is the sim's tier index 0. The UI writes I, II, III.

## 6. Team colour

**A grayscale mask in the alpha channel of the albedo texture.** White is fully tinted by
the owner's team colour, black is untouched, the material's `alphaMode` is `OPAQUE` so no
renderer ever treats it as transparency. The client's toon material multiplies the albedo by
`mix(1, teamColour, mask)` per texel.

Why a texture channel and not a vertex-colour channel: a stripe or a crest within a single
face needs subdivision to express per-vertex, and the albedo texture exists anyway (it
carries the baked AO and gradient). One 512² texture holds everything. Why not a second
texture: the budget is one texture per asset, and every extra sampler is a bind per draw.

Every creep and tower carries a mask. A creep's is on its torso stripe and head crest; a
tower's is on its banner or trim. The mask must cover between 5 % and 25 % of the
texture's opaque area (the gate checks this) so an asset is neither invisible to its owner
nor a solid block of team colour.

## 7. Budgets `[proposed]` — enforced, not advisory

Hard limits per asset, checked by `asset-gate` on the file in `assets/raw/`. A failing
asset changes; the budget does not.

| Class | Triangles | Texture | Bones | Required clips | File (compressed) |
|---|---|---|---|---|---|
| Creep | ≤ 1 500 | 1 × 512² | ≤ 20 | Idle, Walk, Death, Spawn | ≤ 400 KB |
| Tower | ≤ 2 500 | 1 × 512² | ≤ 6 | Build, Idle, Attack, Upgrade, Sell | ≤ 500 KB |
| Projectile / effect | ≤ 100 | ≤ 128² | 0 | — | ≤ 30 KB |
| Tile / prop | ≤ 200 | shared atlas | 0 | — | ≤ 50 KB |

Triangles are counted after export, before compression. A creep's clips are counted in
its file size.

**Global budget for a full match.** Two lanes, 60 towers, and creeps at the **measured**
peak rather than the stated one: bot matches reach 880 to 1 099 creeps on the board
(issue #14), not 300.

| | Limit | Note |
|---|---|---|
| Draw calls | ≤ 200 | the existing render budget (`.claude/skills/perf/budgets.md`) |
| Triangles on screen | ≤ 2.5 M | 1 000 creeps × 1 500 is 1.5 M before towers |
| Texture memory | ≤ 48 MB | 21 model textures at 512² KTX2 plus the atlas |
| Skinned draw calls | see note | |

The last row is the honest problem. A creep drawn as its own `SkinnedMesh` is one draw
call, and 1 000 creeps is five times the draw-call budget. Phase 6 ships individual
skinned meshes with a **dev-mode warning** past 150 skinned creeps, and leaves a marked
seam for an instanced crowd path (baked vertex-animation textures on `InstancedMesh`).
That path is an issue, not part of this factory.

## 8. Units and orientation

| | Convention |
|---|---|
| Scale | 1 unit = 1 tile. A tower's tile is 1 × 1. |
| Up | +Y |
| Forward | **+Z**. Verified: three.js `Object3D.lookAt(target)` turns local +Z toward the target for a non-camera object, and glTF's own convention is +Z forward. A model that faces +Z needs no correction quaternion. |
| Origin | base of the model, centre of the footprint, on y = 0 |
| Handedness | right-handed (glTF, three.js) |

In Blender the authoring frame is Z up and **−Y forward**; the glTF exporter's `+Y up`
setting (the default) maps Blender −Y to glTF +Z, so a model built facing −Y in Blender
lands facing +Z in the game. The exporter applies transforms, so object transforms in the
`.blend` are irrelevant to the result and must not be relied on.

The existing procedural models in `models.ts` face **+X** and are rotated by heading in
`scene.ts`. They are the exception, and they go away as the catalogue replaces them.

The lane: the entrance is at z = 0 (top of the screen) and the exit at z = 23 (bottom).
World x is the lane origin plus the sim's x; world z is the sim's y.

## 9. Animation contract

In full in [`animation-contract.md`](animation-contract.md). The short form: clip names are
exact and capitalised; loops are seamless; 24 fps; no root motion; every one-shot declares
what the game does when it ends.

## 10. Naming

| Class | Pattern | Example |
|---|---|---|
| Creep | `creep_<archetype>_t<tier>` | `creep_runner_t2` |
| Tower | `tower_<archetype>_l<level>` | `tower_splash_l3` |
| Projectile | `proj_<name>` | `proj_bolt` |
| Effect | `fx_<name>` | `fx_hit_frost` |
| Tile | `tile_<name>` | `tile_entrance` |
| Prop | `prop_<name>` | `prop_conifer` |
| Sound | `sfx_<event>_<variant>` | `sfx_death_small_2` |

Lowercase, underscores, ASCII. The id is the spec filename, the manifest key, the glTF
scene name, and the TypeScript identifier the client uses. An id never changes; retiring
one and creating a new one is the rename.

## 11. Licences

| Kind | Ships? | Recorded |
|---|---|---|
| Own work (generated, hand-made in this repo) | yes | `licence: own` |
| CC0 | yes | `licence: cc0`, source URL |
| CC-BY | yes, with attribution in `assets/LICENSES.md` | `licence: cc-by`, author, URL, the attribution line |
| Paid, AI-generated, freelance, anything else | **only after sign-off** | service, terms, date, and `approved_by` |

No asset enters `assets/build/` without a licence line; the gate refuses a spec whose
`source.licence` is missing or is not one of the four kinds. `assets/LICENSES.md` is
generated from the manifest and is never edited by hand.
