# Generator reference

*Generated from `art/generators/ltw_art` (version 0.1.6) by `python3 -m ltw_art.docs`. Do not edit.*

Every name a spec may use: body plans and their parameters, parts and where they attach, rig templates and their bones, animation generators and the clips they produce. `spec-validate` checks specs against the same tables (`registry.json`).

## Body plans

### `biped_heavy` — creep

biped_heavy -- the tank: wide, upright, shoulders far wider than the hips,
short thick legs, a small head sunk between the shoulders. The silhouette is
a block with a head; nothing about it is lean.

**Attachment points:** `head`, `back`, `shoulders`, `shoulder_l`, `shoulder_r`, `hips`, `hand_l`, `hand_r`  
**Material slots:** `skin`, `belly`, `torso_stripe`, `head_crest`, `cloth`, `limbs`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `1.05` | 0.6 .. 1.6 | Standing height to the top of the head. |
| `shoulder_width` | `0.62` | 0.3 .. 1.0 |  |
| `hip_width` | `0.34` | 0.15 .. 0.7 |  |
| `arm_thickness` | `0.13` | 0.05 .. 0.3 |  |
| `leg_length` | `0.3` | 0.1 .. 0.6 |  |
| `head` | `brute` | `brute` / `boar` / `golem` | Head shape. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `biped_lean` — creep

biped_lean -- a lean two-legged runner: long legs, narrow torso, a low
forward lean, small head out front. The lean is the silhouette: the torso is
pitched forward so the profile reads as a diagonal line, not a post.

**Attachment points:** `head`, `back`, `shoulders`, `tail`, `hips`  
**Material slots:** `skin`, `belly`, `torso_stripe`, `head_crest`, `limbs`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.55` | 0.3 .. 1.2 | Standing height to the top of the head. |
| `leg_length` | `0.28` | 0.1 .. 0.7 | Hip to ground. |
| `torso_width` | `0.18` | 0.08 .. 0.5 |  |
| `torso_length` | `0.3` | 0.15 .. 0.8 | Hip to neck, along the leaning spine. |
| `head` | `fox` | `fox` / `hound` / `raptor` / `imp` | Head shape. |
| `lean` | `0.55` | 0.0 .. 1.0 | Forward pitch of the torso, radians. |
| `arms` | `True` |  | Short arms held forward, or none. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `blob` — creep

blob -- a slime: a squashed sphere with a few lumps, a glowing core, no
limbs. The rig is four bones (root, core, top, front, back) so it can
squash, stretch and ooze.

**Attachment points:** `top`, `front`, `back`  
**Material slots:** `skin`, `core`, `torso_stripe`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.4` | 0.2 .. 1.0 | Height of the body. |
| `squash` | `0.7` | 0.3 .. 1.2 | Height / width ratio. |
| `lumps` | `3` | 0 .. 8 | Extra bumps on the surface. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `bolt` — projectile

bolt -- an arrow: shaft, iron head, pale fletching. Points along +Z.

**Attachment points:** none  
**Material slots:** `shaft`, `head`, `fletching`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `length` | `0.36` | 0.1 .. 0.8 |  |
| `radius` | `0.012` | 0.005 .. 0.05 |  |

### `cannon` — tower

cannon -- the mortar: a squat stone drum with a bronze barrel pitched at the
sky, iron bands, a pile of shot beside it. Squat on purpose: height is at
most 1.2 × width, so the thing that hits an area looks like it lobs.

**Attachment points:** `turret_top`, `muzzle`, `base_ring`, `banner`  
**Material slots:** `base`, `drum`, `bands`, `barrel`, `trim`, `banner`, `shot`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.9` | 0.5 .. 1.4 | Plinth to the top of the drum. |
| `base_size` | `0.84` | 0.5 .. 0.84 |  |
| `drum_radius` | `0.34` | 0.2 .. 0.42 |  |
| `barrels` | `1` | 1 .. 3 |  |
| `barrel_length` | `0.42` | 0.2 .. 0.8 |  |
| `pitch_deg` | `55` | 20 .. 80 | Barrel elevation. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `crystal_emitter` — tower

crystal_emitter -- the frost shrine: a blue-grey pedestal with a cluster of
glowing crystals. The crystals are the visible emitter the slow tower's
silhouette rule demands, and they are the glow material so they read from
any angle.

**Attachment points:** `turret_top`, `muzzle`, `base_ring`, `banner`  
**Material slots:** `base`, `pedestal`, `crystal`, `ring`, `trim`, `banner`, `snow`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `1.1` | 0.6 .. 1.8 | Plinth to the tip of the main crystal. |
| `base_size` | `0.84` | 0.5 .. 0.84 |  |
| `crystal_height` | `0.55` | 0.2 .. 1.2 |  |
| `ring_crystals` | `2` | 0 .. 8 |  |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `hover` — creep

hover -- a floating creature: a bell (jellyfish) or a balloon body with
tendrils hanging below, no legs, clear of the ground by `hover_height`.
The rig is root/body/bell/tendrils; hover_bob drives Idle and Walk.

**Attachment points:** `top`, `front`, `back`, `underside`  
**Material slots:** `skin`, `belly`, `torso_stripe`, `tendrils`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.6` | 0.3 .. 1.2 | Top of the bell above the ground, including hover_height. |
| `hover_height` | `0.25` | 0.05 .. 0.6 | Gap between the ground and the lowest tendril. |
| `bell_radius` | `0.22` | 0.1 .. 0.5 |  |
| `tendrils` | `5` | 0 .. 12 |  |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `insect` — creep

insect -- the swarm creep: a beetle. Low, wide, longer than tall, six (or
more) legs, a shell over most of the body, mandibles. Small on purpose:
the archetype ships in numbers and reads as a texture of moving dots.

**Attachment points:** `head`, `back`, `abdomen`, `shoulders`  
**Material slots:** `shell`, `belly`, `torso_stripe`, `head_crest`, `legs`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.36` | 0.15 .. 0.9 | Height to the top of the shell. |
| `body_length` | `0.5` | 0.2 .. 1.2 |  |
| `legs` | `6` | 4 .. 8 | Leg count, always even. |
| `shell_ratio` | `0.7` | 0.4 .. 1.0 | How much of the body the shell covers. |
| `mandibles` | `True` |  |  |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `orb` — projectile

orb -- a frost bolt: a glowing octahedron stretched along its flight.

**Attachment points:** none  
**Material slots:** `core`, `halo`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `radius` | `0.09` | 0.03 .. 0.25 |  |
| `stretch` | `1.6` | 1.0 .. 3.0 | Length along the flight, as a multiple of the radius. |

### `pillar` — tower

pillar -- a plain column with a capital: the neutral tower body for anything
that is not a keep, a mortar or a shrine. What sits on top comes from the
part library (a crystal cluster, a banner, an emissive ring).

**Attachment points:** `turret_top`, `muzzle`, `base_ring`, `banner`  
**Material slots:** `base`, `shaft`, `capital`, `trim`, `banner`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `1.4` | 0.8 .. 2.2 | Plinth to capital. |
| `base_size` | `0.84` | 0.5 .. 0.84 |  |
| `shaft_radius` | `0.2` | 0.1 .. 0.35 |  |
| `flutes` | `0` | 0 .. 12 | Vertical grooves; 0 for a plain shaft. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `quadruped` — creep

quadruped -- a four-legged runner. Long body, low head out front, tail up.
The runner archetype's silhouette rule is "lean, forward-leaning, a
horizontal line", so the body is a capsule longer than it is tall, the legs
are thin, and the head sits below the shoulder line.

**Attachment points:** `head`, `back`, `shoulders`, `tail`, `hips`  
**Material slots:** `skin`, `belly`, `torso_stripe`, `head_crest`, `limbs`, `eyes`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `0.55` | 0.25 .. 1.2 | Standing height to the top of the back, in tiles. |
| `body_length` | `0.5` | 0.2 .. 1.2 | Shoulder to hip, in tiles. |
| `leg_length` | `0.24` | 0.08 .. 0.6 | Hip to ground. |
| `body_radius` | `0.11` | 0.05 .. 0.3 | Torso thickness. |
| `head` | `hound` | `hound` / `boar` / `lizard` | Head shape. |
| `head_size` | `1.0` | 0.6 .. 1.6 | Head scale relative to the body radius. |
| `tail` | `up` | `up` / `down` / `none` |  |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

### `shell` — projectile

shell -- a cannonball. An iron sphere, nothing else; it reads as a dot.

**Attachment points:** none  
**Material slots:** `body`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `radius` | `0.09` | 0.03 .. 0.2 |  |

### `tile_flat` — tile

tile_flat -- a 1 × 1 slab, 2 cm thick, for the entrance and exit tiles and
the blocked-placement preview. Colour comes from the palette role.

**Attachment points:** none  
**Material slots:** `face`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `inset` | `0.02` | 0.0 .. 0.1 | Gap to the tile edge. |

### `tile_marker` — tile

tile_marker -- a slab with a raised glyph: an arrow for the entrance, a
ring for the exit, a cross for a blocked tile, a chevron for the leak
marker. The glyph is the glow material so it reads on any turf.

**Attachment points:** none  
**Material slots:** `face`, `rune`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `rune` | `arrow` | `arrow` / `cross` / `ring` / `chevron` | The glyph raised on the tile. |
| `height` | `0.03` | 0.01 .. 0.2 | How far the glyph stands above the slab. |

### `turret_on_base` — tower

turret_on_base -- the guard tower: a tapering round keep on a square plinth
with a crenellated parapet. Tall and thin, as the single-target silhouette
rule asks: height is at least 2.5 × the keep's width.

**Attachment points:** `turret_top`, `muzzle`, `base_ring`, `banner`  
**Material slots:** `base`, `keep`, `parapet`, `roof`, `trim`, `banner`, `slit`

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `height` | `1.2` | 0.8 .. 2.0 | Plinth to parapet. |
| `base_size` | `0.84` | 0.5 .. 0.84 |  |
| `keep_radius` | `0.27` | 0.15 .. 0.4 |  |
| `merlons` | `6` | 0 .. 10 | Blocks around the parapet. |
| `roof` | `none` | `none` / `cone` / `spire` | What sits on top. |
| `seed` | `0` | 0 .. 65535 | Extra entropy on top of the spec id, for variants of one plan. |

## Parts

A part is placed at an attachment point and scales with it. `triangles` is the part's own cost at scale 1.

| Part | Attaches at | Default | Slots | Triangles | Description |
|---|---|---|---|---|---|
| `back_plates` | `back` | `back` | `plate` | 36 | Three overlapping plates down the spine. |
| `banner` | `banner`, `back` | `banner` | `pole`, `banner` | 24 | A pole with a hanging banner in the accent colour, team-maskable. The tier-3 / level-3 flourish. |
| `club` | `hand_l`, `hand_r` | `hand_r` | `club` | 46 | A wooden club with a knob, held in a hand, resting over the shoulder. |
| `crystal_cluster` | `back`, `head`, `turret_top`, `top` | `back` | `crystal` | 40 | Five glowing crystal shards of different heights, leaning outward. The level-3 part for the frost shrine; a tier-3 part for creeps. |
| `crystal_shards` | `back`, `shoulders`, `turret_top` | `back` | `crystal` | 24 | Three small crystal shards, a lighter touch than the cluster. |
| `emissive_trim` | `base_ring`, `torso_stripe`, `back` | `base_ring` | `glow` | 48 | Six small glowing studs in a ring: the tier-3 emissive strip. Octahedra, not spheres: 8 triangles each instead of 60, which is the difference between a tier-3 creep fitting its budget and not. |
| `extra_barrel` | `turret_top` | `turret_top` | `barrel` | 56 | A second, shorter barrel beside the first, pitched the same way. The level-3 part for the mortar. |
| `gold_ring` | `base_ring`, `turret_top`, `hips`, `abdomen` | `base_ring` | `trim` | 44 | A thin ring of trim around the body: gold at level 3, otherwise a dark band. The cheapest level-3 signal there is; on a creep it is a belt at the hips (or round a beetle's abdomen). |
| `head_crest` | `head` | `head` | `crest` | 36 | A fin-like crest on the head, three thin fins fanning back. Accent colour and team-maskable. |
| `horns` | `head` | `head` | `horn` | 16 | Two curved-looking horns (two cones each) sweeping up and out. |
| `iron_bands` | `base_ring` | `base_ring` | `band` | 56 | Two iron bands around the body, a little apart. |
| `roof_cone` | `turret_top` | `turret_top` | `roof` | 16 | A conical wooden roof with a small finial. The level-2 part for the keep. |
| `shoulder_plates` | `shoulders`, `shoulder_l`, `shoulder_r` | `shoulders` | `plate` | 24 | One armour plate over each shoulder, angled down and out. The tier-2 part for heavy creeps. Plain boxes: at this size a bevel is invisible and costs four times the triangles. |
| `shoulder_spikes` | `shoulders`, `shoulder_l`, `shoulder_r` | `shoulders` | `spike` | 40 | A row of four spikes over each shoulder, angled outward and back. The tier-2 signature part for creeps: a silhouette change with no new body plan. |
| `spike_row` | `back`, `abdomen` | `back` | `spike` | 40 | A row of five spikes along the spine, tallest in the middle. |
| `spire` | `turret_top` | `turret_top` | `spire` | 13 | A tall thin spire in the trim colour: gold at level 3. |
| `tail_club` | `tail`, `hips` | `tail` | `tail`, `club` | 50 | A short thick tail ending in a spiked club. |
| `tail_long` | `tail`, `hips` | `tail` | `tail` | 20 | A long tapering tail, two cones end to end, sweeping back and up. |

## Rig templates

### `biped_large`

Sixteen bones for the heavy biped: spine chain, head, two per leg, three
per arm (upper arm, forearm, hand) so a club can swing from the hand.

**Fits:** `biped_heavy`  
**Bones (16):** `root`, `hips`, `spine`, `chest`, `neck`, `head`, `thigh_l`, `shin_l`, `thigh_r`, `shin_r`, `upper_arm_l`, `forearm_l`, `hand_l`, `upper_arm_r`, `forearm_r`, `hand_r`  
**IK:** none

### `biped_small`

Sixteen bones for the lean biped: spine chain, head, a two-bone tail, two
bones per leg and two per arm. Arms have no hand bone; the forearm ends at
the hand joint.

**Fits:** `biped_lean`  
**Bones (16):** `root`, `hips`, `spine`, `chest`, `neck`, `head`, `tail_1`, `tail_2`, `thigh_l`, `shin_l`, `thigh_r`, `shin_r`, `upper_arm_l`, `forearm_l`, `upper_arm_r`, `forearm_r`  
**IK:** none

### `blob`

Five bones: root, a core the body hangs from, and top/front/back handles
for squash, stretch and ooze.

**Fits:** `blob`  
**Bones (5):** `root`, `core`, `top`, `front`, `back`  
**IK:** none

### `hover`

Four bones: root, body (the skirt), bell (the head and eyes), tendrils.
hover_bob moves the root; the bell and tendrils lag it.

**Fits:** `hover`  
**Bones (4):** `root`, `body`, `bell`, `tendrils`  
**IK:** none

### `insect`

Twelve bones: thorax, head, abdomen and one bone per leg (four per side;
a six-legged plan leaves the fourth pair unused). Legs are single bones
because at 17 px on screen a knee is invisible.

**Fits:** `insect`  
**Bones (12):** `root`, `thorax`, `head`, `abdomen`, `leg_l1`, `leg_l2`, `leg_l3`, `leg_l4`, `leg_r1`, `leg_r2`, `leg_r3`, `leg_r4`  
**IK:** none

### `quadruped`

Sixteen bones: root, a three-bone spine (hips, spine, chest), neck and head,
two bones per leg, a two-bone tail. Legs are FK; the walk generator plants
the feet arithmetically rather than through an IK solver, which keeps the
clip a pure function of its parameters (and IK constraints do not survive a
glTF export anyway).

**Fits:** `quadruped`  
**Bones (16):** `root`, `hips`, `spine`, `chest`, `neck`, `head`, `tail_1`, `tail_2`, `thigh_fl`, `shin_fl`, `thigh_fr`, `shin_fr`, `thigh_bl`, `shin_bl`, `thigh_br`, `shin_br`  
**IK:** none

### `turret`

Four bones for every tower: root, base (the plinth and body), turret (the
top, which recoils, pulses or flashes), muzzle (where the projectile
leaves; the `muzzle` attachment follows it).

**Fits:** `turret_on_base`, `cannon`, `crystal_emitter`, `pillar`  
**Bones (4):** `root`, `base`, `turret`, `muzzle`  
**IK:** none

## Animation generators

### `build_up` — Build, one-shot

A tower is built: it rises from the ground in two stages -- the base first,
then the turret pops up with a small overshoot -- and ends at rest.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.8` | 0.3 .. 2.0 |  |
| `overshoot` | `0.1` | 0.0 .. 0.4 |  |

### `collapse_forward` — Death, one-shot

The creature's legs fold and the body drops, it pitches forward a little,
hits the ground at the impact marker and rolls onto its side. The last frame
is held by the client as the corpse. Works on any rig with a root; uses
legs, head and tail when present. The pitch is small on purpose: the root is
at the feet, so a large pitch there stands the model on its nose.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.8` | 0.3 .. 2.0 | Seconds from the last step to lying still. |
| `impact` | `0.6` | 0.1 .. 0.95 | Normalised time the body hits the ground; the `impact` marker. |
| `sink` | `0.0` | 0.0 .. 0.5 | How far below ground the root ends, so a corpse can settle into the turf. |
| `drop` | `0.3` | 0.0 .. 0.8 | How far the body drops as the legs fold, as a fraction of the model height. |
| `roll` | `0.9` | 0.0 .. 1.6 | How far it rolls onto its side after the impact, radians. |

### `crumble` — Death / Sell, one-shot

The model shivers, then sinks and shrinks into the ground as if crumbling.
Root-only, so it fits any rig: a blob's death, a tower's sale.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.7` | 0.3 .. 2.0 |  |
| `impact` | `0.5` | 0.1 .. 0.95 | When the pieces hit the ground; the `impact` marker. |

### `hover_bob` — Idle / Walk, loop

A floating bob: the root rises and falls, the bell squashes at the bottom
of the bob, the tendrils lag. As Walk it adds a forward tilt.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `amplitude` | `0.06` | 0.0 .. 0.3 | Vertical bob, in tiles. |
| `duration` | `2.0` | 0.5 .. 6.0 | One bob, in seconds. |
| `tilt` | `0.1` | 0.0 .. 0.5 | Forward tilt while moving (Walk), radians. |
| `stride` | `1.0` | 0.1 .. 3.0 | Tiles per cycle if used as Walk. |

### `idle_breathe` — Idle, loop

A breath: the chest (or whatever bone is nearest a chest) rises and falls
once per cycle, the head nods a little late, and nothing else moves. Works
on any rig that has a root; uses chest/neck/head when they exist.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `amplitude` | `0.02` | 0.0 .. 0.1 | Chest rise, in tiles. |
| `duration` | `1.5` | 0.5 .. 4.0 | One breath, in seconds. |
| `head_nod` | `0.06` | 0.0 .. 0.3 | Head pitch, radians. |

### `pulse` — Attack / Idle, one-shot

A pulse: the turret (or the whole model) swells to the fire marker and
relaxes. The frost shrine's attack, and a plain Idle for towers when used
as a loop generator elsewhere.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.4` | 0.1 .. 4.0 |  |
| `amount` | `0.12` | 0.0 .. 0.5 | Peak scale increase. |
| `fire` | `0.3` | 0.0 .. 0.9 | When the pulse peaks; the `fire` marker. |

### `rise_from_ground` — Spawn / Build, one-shot

The model rises out of the ground and pops to full size with a small
overshoot. Root-only, so it works on every rig. The final frame is the rest
pose, so the client can crossfade into Idle or Walk with no jump. `depth` is
a fraction of the height and is resolved by the builder, which knows it.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.6` | 0.2 .. 2.0 |  |
| `overshoot` | `0.08` | 0.0 .. 0.3 | How far past full size the pop goes before settling. |
| `depth` | `1.0` | 0.2 .. 2.0 | Start depth below ground, as a fraction of the model's own height. |
| `land` | `0.7` | 0.0 .. 1.0 | Normalised time the feet touch down; the `land` marker. |

### `scuttle` — Walk, loop

An insect scuttle: legs alternate in a tripod gait (l1, l3, r2 together),
the body sways side to side and the head twitches. Fast and small.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `stride` | `0.4` | 0.05 .. 2.0 | Tiles per cycle if the creature moved. |
| `cadence` | `7.0` | 1.0 .. 14.0 | Cycles per second: fast, an insect. |
| `sway` | `0.08` | 0.0 .. 0.4 | Body roll, radians. |
| `lift` | `0.35` | 0.0 .. 1.0 | Leg lift, radians. |

### `sell_sink` — Sell, one-shot

A tower is sold: it sinks into the ground, spinning a little, and ends
below the turf at zero scale.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.6` | 0.2 .. 1.5 |  |

### `turret_recoil` — Attack, one-shot

A shot: the turret snaps back and down at the fire marker and eases home.
The muzzle bone flares (scales) for two frames.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.35` | 0.1 .. 0.6 |  |
| `kick` | `0.08` | 0.0 .. 0.3 | How far the turret drops and rocks back, in tiles. |
| `fire` | `0.1` | 0.0 .. 0.9 | When the shot leaves; the `fire` marker. |

### `upgrade_flash` — Upgrade, one-shot

An upgrade lands: the whole model squashes and pops to full size with an
overshoot, then rests. Plays on the NEW level's model.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `duration` | `0.5` | 0.2 .. 1.5 |  |
| `overshoot` | `0.1` | 0.0 .. 0.4 |  |

### `walk_biped` — Walk, loop

A two-legged walk in place: legs alternate, knees fold on the forward
swing, arms counter-swing, the body bobs twice a cycle and leans into it.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `stride` | `1.0` | 0.1 .. 3.0 | Tiles per cycle if the creature moved; the client divides speed by this. |
| `cadence` | `2.0` | 0.5 .. 8.0 | Cycles per second at natural speed. |
| `bob` | `0.03` | 0.0 .. 0.15 |  |
| `swing` | `0.6` | 0.1 .. 1.2 | Leg swing amplitude, radians. |
| `lean` | `0.1` | 0.0 .. 0.6 | Extra forward lean while walking. |
| `arm_swing` | `0.4` | 0.0 .. 1.2 |  |

### `walk_quadruped` — Walk, loop

A four-legged walk cycle in place: thighs swing fore and aft, shins fold on
the forward swing so the foot clears the ground, the body bobs twice a
cycle, the head counter-nods and the tail wags. One cycle is two steps of
each leg. The `stride` parameter is not used by the clip itself -- it is
recorded so the client can scale the loop to the creature's speed.

| Parameter | Default | Range | Meaning |
|---|---|---|---|
| `stride` | `1.0` | 0.1 .. 3.0 | Tiles covered per cycle if the creature moved; the client divides speed by this. |
| `cadence` | `2.5` | 0.5 .. 8.0 | Cycles per second at the creature's natural speed. |
| `bob` | `0.04` | 0.0 .. 0.15 | Body rise per step, in tiles. |
| `swing` | `0.55` | 0.1 .. 1.2 | Leg swing amplitude, radians. |
| `gait` | `trot` | `walk` / `trot` / `gallop` | Which legs move together. |
