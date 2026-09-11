# Audio

Targets and delivery for every sound the game plays, and the list of events that need one.
Today every sound is synthesised in the browser (ADR-0017) and nothing is a file. This
document covers files as well, because the factory produces them: a synthesised placeholder
is rendered to a file by `audio-synth`, an imported sound is normalised by `audio-import`,
and both land in the manifest the same way.

## 1. Loudness `[proposed]`

| | SFX | Stingers (match end, tier unlock) | Music (none yet) |
|---|---|---|---|
| Integrated loudness | −16 LUFS | −16 LUFS | −18 LUFS |
| True peak ceiling | −1.0 dBTP | −1.0 dBTP | −1.0 dBTP |
| Loudness range | not constrained | | |

Measured with `ffmpeg -af ebur128` and normalised with `loudnorm` in two-pass mode.
Short SFX under 400 ms are measured as **momentary** loudness rather than integrated,
because EBU R128 integrated loudness gates out most of a short sound; the tool says which
it used. In-game mix levels (the `sfx` bus, the crowd scaling in `mixer.ts`) sit on top of
this and are not the file's job.

## 2. Format `[proposed]`

| | Value |
|---|---|
| Source sample rate | 48 kHz, 24-bit WAV, mono for SFX, stereo for stingers |
| Delivery | **Opus in WebM** (`.webm`, 64 kbps VBR mono / 96 kbps stereo) plus **MP3** (`.mp3`, 128 kbps) as fallback |
| Selection | `canPlayType('audio/webm; codecs=opus')`, then MP3 |
| Max length | SFX 2.0 s · stingers 4.0 s · any loop 30 s |
| Silence | trimmed to −60 dBFS at head and tail; 5 ms fade at each end |

Why not Ogg/Opus: caniuse (checked 2026-09) lists Opus as **partial** in Safari on
macOS through Safari 27, and full on iOS only from 18.4; Ogg-container Opus is the part
that does not play. Opus in WebM and Opus in CAF do. Why not MP3 alone: MP3 pads the
head of every file, so a looping sound never loops cleanly, and 128 kbps MP3 is three
times the size of 64 kbps Opus for the same short sound. Why not AAC: Firefox's AAC
support depends on the operating system's decoder.

Two files per sound. The manifest lists both; the client picks once at start-up.

## 3. Naming

`sfx_<event>_<variant>`, matching the style sheet. Variants are numbered from 1;
frequent events have **three** variants and the client rotates them with a pitch
variation of ±4 % `[proposed]`, as `audio.ts` already does for its synthesised sounds.

## 4. Events that need a sound

Derived from the `Audio` interface in `packages/client/src/audio/audio.ts` (what is voiced
today) plus the events the animation contract introduces. **Every one has a sound from day
one**: synthesised placeholders from `audio-synth` until something better replaces them.

| Event | Sound id | Variants | Frequent (budgeted) | Notes |
|---|---|---|---|---|
| Tower fires, single-target | `sfx_shot_single_n` | 3 | yes | at the `fire` marker |
| Tower fires, splash | `sfx_shot_splash_n` | 3 | yes | |
| Tower fires, slow | `sfx_shot_slow_n` | 3 | yes | |
| Projectile hits, single-target | `sfx_hit_single_n` | 3 | yes | |
| Projectile hits, splash | `sfx_hit_splash_n` | 2 | yes | the loudest hit; one voices many |
| Projectile hits, slow | `sfx_hit_slow_n` | 2 | yes | |
| Creep spawns | `sfx_spawn_<size>_n` | 2 per size | yes | `small` (swarm), `medium` (runner), `large` (tank); at the `land` marker. **New**: not voiced today |
| Creep dies | `sfx_death_<size>_n` | 3 per size | yes | at the `impact` marker |
| Creep leaks, mine | `sfx_leak_mine` | 1 | no | a warning |
| Creep leaks, theirs | `sfx_leak_theirs` | 1 | no | good news |
| Creep respawns after a leak | `sfx_respawn` | 1 | yes | the `Spawn` variant for a looping creep. **New** |
| Tower built | `sfx_build_<archetype>` | 1 each | no | `mine` plays full, `theirs` at −6 dB |
| Tower upgraded | `sfx_upgrade` | 1 | no | |
| Tower sold | `sfx_sell` | 1 | no | |
| Creep sent | `sfx_send` | 1 | yes | a click's confirmation |
| Income paid | `sfx_income` | 1 | no | |
| Tier unlocked | `sfx_tier_unlock` | 1 | no | stinger |
| Tower selected | `sfx_select` | 1 | no | UI |
| Command refused | `sfx_refused` | 1 | no | UI |
| Button click | `sfx_click` | 1 | no | UI |
| Match won | `sfx_match_won` | 1 | no | stinger |
| Match lost | `sfx_match_lost` | 1 | no | stinger |

Thirty-eight files before variants of the frequent events are counted; about sixty
with them. "Frequent" means the event passes a `Budget` in `mixer.ts` and one admitted
sound may stand for many.

## 5. What is not here

No music, no ambience. Two beds were written and cut (ADR-0017). If that changes, this
document gains a "music" section with a loop-length rule and a bus, and nothing in the
event table moves.
