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
oscillators, a shared noise buffer, biquad filters and gain envelopes. That covers the whole
palette — bow twang, mortar thump, frost chime, three kinds of death, hammer blows, coins, a
bell for a lost life, a brass call for a tier — and a bed under it: a detuned pad stepping
round a four-chord minor cycle, plucked notes on the minor pentatonic, wind, birds over a
quiet field and a drum under a busy one. Every chord tone sits on the pentatonic, so a pluck
can land anywhere without clashing; the test pins that.

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
- Synthesis has a ceiling. There will be no orchestral score this way; the bed is a mood, not
  a soundtrack. If that ceiling is ever the problem, the loader this ADR declined is the next
  step, and the event plumbing is already in place for it.
