# ADR-0017 — Sound is synthesised, fed by the same inferred events as the effects

- **Date:** 2026-09-10
- **Status:** Accepted

## Context

The game had no sound. ADR-0015 settled that the look is procedural and that shots, hits,
deaths and leaks are inferred in the renderer by comparing two ticks rather than emitted by
the sim. Sound faces the same three choices: audio files and a loader, synthesis in code, or
events added to the sim. It also faces two constraints of its own: browsers will not start
audio without a user gesture, and a flood produces hundreds of events a second.

## Decision

**Every sound is synthesised with Web Audio** (`packages/client/src/audio/audio.ts`):
oscillators, a shared noise buffer, biquad filters and gain envelopes, **in the idiom of the
map this game descends from**. What makes that idiom is treatment rather than instruments,
and treatment is all synthesis:

- Everything sits in a hall: one convolution reverb with a synthesised impulse, fed by per-bus
  sends — a little on effects, a lot on music.
- A hit is three layers — a click, a body with real low end, a tail. The cannon is a crack, a
  sub thump and a second of falling rumble, not a sine sweep.
- Timbres are dark and slightly gritty: filtered saws and shaped noise, a soft clipper on the
  master, and nothing above what a 22 kHz sample of the era would carry.
- Nothing repeats exactly: every event is pitch-varied a few percent, as a sound bank with
  several variants would play.
- The music is orchestral pastiche at a march's pace: detuned string swells, a formant choir,
  harp arpeggios on the chord, a solemn horn phrase every other turn, timpani on the changes
  and war drums once the field is busy. The cycle is i–VI–VII–i, iv–VI–V–i in A minor with the
  harmonic-minor V; the harp arpeggiates chord tones only, so it can never clash with the pad,
  and the tests pin the key, the voicing and the phrase length.

**The scene feeds it the events it already infers.** Nothing in the audio reads sim state.
**No event is added to the sim.**

**Frequent events go through a budget** (`audio/mixer.ts`): a minimum gap and a rolling
per-second cap, and one admitted sound is played a little louder for the events it stands
for. **Sounds are placed** by panning against the camera's target and attenuating outside the
frame; the camera has no yaw, so depth attenuates gently and does not pan.

**The context is created on the start button's click** and resumed by any later gesture;
mute and volume are the only controls and persist in `localStorage`; `M` toggles mute.

## Consequences

- No binaries, no loader, no licensing. Every sound is a few lines someone can read and
  retune, and a new event costs one function.
- A flood sounds like a battle rather than a hundred clicks or a locked-up mixer: at most a
  handful of shots and deaths a second are voiced, scaled by how many they stand for, and a
  master compressor keeps the sum from clipping.
- The arithmetic — budgets, placement, the scale — is tested in node; the synthesis is not,
  because there is no AudioContext there. A broken envelope is found by ear.
- Synthesis has a ceiling. The bed is a pastiche of an orchestra, not one; there will be no
  recorded choir this way. If that ceiling is ever the problem, the loader this ADR declined is
  the next step, and the event plumbing is already in place for it.
- The mix was tuned by construction and by the numbers, not yet by ear in a live match. The
  bus levels (`sfx`, `music`, `ambience` and their reverb sends) are the four knobs to move
  first when it is.
