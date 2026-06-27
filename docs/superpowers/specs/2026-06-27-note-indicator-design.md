# Real-Time Note Indicator — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation plan
**Builds on:** the effects engine + calibration app. Reuses the source `AnalyserNode`
tap and the Vitest test setup.

## Vision

Show the currently-played note (name + octave) live in a circle on screen, e.g.
**A2**, **C♯4**, updated in real time as you play. Dims to `—` when nothing
confident is detected.

## Scope (locked during brainstorming)

- Display **note name + octave** (not just name; cents/tuner tint deferred).
- **Monophonic** pitch detection (single notes/leads read cleanly; full chords
  resolve to the dominant/lowest note — inherent, not a bug).
- **Reuse the existing source analyser** — no new audio nodes, no audio-path change.

## Architecture

Two pure modules + browser glue:

- `src/pitch/detector.js` — `autoCorrelate(buffer, sampleRate) → number` returns the
  detected fundamental frequency in Hz, or `-1` when there is no confident pitch
  (RMS below a gate, or the autocorrelation peak too weak). Operates on a
  time-domain `Float32Array`. **Pure.**
- `src/pitch/note.js` —
  - `freqToNote(freq) → { name, octave, cents }`: `midi = 69 + 12*log2(freq/440)`,
    round to nearest semitone for name+octave; `cents` = signed distance to the
    exact semitone (kept for a future tuner tint, not displayed now).
  - `noteLabel(note) → string` e.g. `"A2"`, `"C#4"`. **Pure.**
- **Integration** (`src/main.js`, `index.html`): a circle element shows the label.
  Bump the existing source analyser to `fftSize = 2048` (needed to resolve low E,
  ~82 Hz; autocorrelation needs ≳2 periods). In a `requestAnimationFrame` loop, read
  `getFloatTimeDomainData` → `autoCorrelate` → `freqToNote` → update the circle. On
  `-1`, dim the circle and show `—`.

## Data flow

`source → analyser (existing read-only tap) → [rAF] autoCorrelate → freqToNote → circle`

No node is inserted into the audio path; zero latency impact on the monitored tone.
The existing meter loop and calibration capture also use this analyser; raising
`fftSize` to 2048 is compatible with both (the meter reads time-domain; calibration
reads frequency-domain — `frequencyBinCount` becomes 1024, still fine for the band
mapping).

## Note naming

- Names: `['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']`.
- Octave from MIDI: `octave = floor(midi/12) - 1` (so MIDI 69 = A4).
- Display sharps (no flats) for simplicity.

## Detector details

- Standard normalized autocorrelation:
  - Compute RMS; if below a gate (e.g. ~0.01), return `-1` (silence).
  - Find the best lag in a plausible range (covering ~70 Hz–1200 Hz for guitar) via
    autocorrelation; refine with parabolic interpolation around the peak.
  - If the peak correlation is too weak (below a confidence threshold), return `-1`.
- Frequency = `sampleRate / refinedLag`.

## UI

- A circle (CSS) in the app showing the note label, large and centered.
- Live update each rAF frame; brief hold/dim logic so it doesn't flicker (show `—`
  only after detection has been `-1` for a few consecutive frames — optional smoothing
  handled in glue).

## Testing

- `detector` (pure): synthetic sine of known frequency (e.g. 440 Hz, 82.41 Hz) →
  returns within a few Hz; silence/zero buffer → `-1`.
- `note` (pure): 440 → `A`/4/~0¢; 261.626 → `C`/4; 82.41 → `E`/2; `noteLabel` formats
  `"A4"`, `"E2"`, `"C#4"`.
- Circle/rAF wiring: browser glue, verified by ear/eye.

## Out of scope (later)

- Cents / in-tune color (tuner) — `freqToNote` already returns `cents`.
- Polyphonic/chord detection.
- Note history / scrolling display.

## Success criteria

Play single notes in Chrome; the circle shows the correct note+octave in real time
and dims to `—` when you stop. No audible latency change to the guitar tone.
