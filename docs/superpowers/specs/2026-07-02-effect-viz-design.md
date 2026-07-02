# Effect-Viz Screens — Design Spec

**Date:** 2026-07-02
**Maestro stories:** f49a8012 (viz), 36997ef5 (broken effects), 7b8956a0 (new effects)
**Status:** User-requested ("animate how the sound waves are altered with the current
knob settings"); executes AFTER the top-tier UI pass lands (same files).

## 1. Concept

Every pedal's screen (the `.pedal-plate` lens area) becomes a **live, param-driven
animation of what the effect does to sound** — not decoration, a tiny honest diagram.
Turning a knob visibly changes the animation (delay time spreads the echoes, feedback
adds more of them, drive squares the wave). GarageBand-grade: the screen keeps its glass
gloss + bezel from the UI pass; the viz renders behind the glass.

## 2. Architecture

- `src/chain-ui/fx-viz.js` — a registry `VIZ[type] = draw(g, t, params, w, h)` of pure
  2D-canvas draw functions + one shared ticker.
- Each pedal gets a small `<canvas class="pedal-viz">` inside the plate (device-pixel
  aware, ~2x). The motif SVG remains as the palette/tile art; on the board the canvas
  replaces the static motif.
- **One shared ticker** (~12 fps via a single `setInterval`, NOT per-pedal rAF): iterates
  registered visible canvases, calls the type's `draw` with **live params** (read from
  the chain model via a getter registered at render; `setParamLive` already mutates the
  same object → knob turns are reflected on the next tick with zero extra wiring).
- Pauses on `document.hidden`; `prefers-reduced-motion` → draw one static frame, no
  ticker. Canvas is cheap (tiny, no filters); ~6 pedals × 12 fps is negligible.
- Bypassed pedal: viz dims + freezes (single static frame, overlay from UI pass).

## 3. Per-effect visualizations (param mapping in parentheses)

| Type | Screen shows |
|---|---|
| delay / pingpong | a pulse + decaying echo bars — spacing (time), count+decay (feedback), pingpong alternates top/bottom rows (spread) |
| tape-echo | same as delay + slight vertical wobble/wow on echoes (flutter feel) |
| reverb | impulse + fading tail cloud — length (size), brightness (mix) |
| chorus | 2–3 slightly detuned sines drifting in/out of phase (rate, depth) |
| flanger | a comb: moving notch teeth sweeping (rate), tooth depth (depth) |
| phaser | spectrum line with traveling notch dots (rate, stages) |
| vibrato | one sine whose wavelength breathes (rate, depth) |
| tremolo | sine inside a pulsing amplitude envelope (rate, depth) |
| rotary | rotating horn glyph, spin speed = speed knob |
| autopan | a ball sweeping L↔R between two speaker glyphs (rate) |
| ringmod | two sines multiplying into a lumpy product wave (freq) |
| drive / fuzz / distortion | **param-true transfer**: input sine passed through the effect's ACTUAL WaveShaper curve → output shape squares/folds as drive rises |
| octave | wave + a ghost wave at half wavelength beneath it |
| compressor / limiter | in/out level bars + a bending knee curve; GR needle kicks (threshold, ratio) |
| gate | noisy signal with a threshold line; below-line parts chopped (threshold) |
| eq | **param-true response curve** (computed from the biquad settings) |
| cabinet | speaker cone with a subtle excursion pulse |
| wah / autowah | a bandpass hump sliding along a spectrum (position/envelope) |
| boost | clean sine growing taller + level arrow (gain) |
| widener | mid line splitting into two spreading arcs (width) |
| pitchshift / harmonizer / whammy | parallel note-lines at shifted intervals (semitones) |
| looper | circular loop with a progress arc |

The drive-family and EQ visualizations are **mathematically true** (they evaluate the
same curve/biquad the audio uses), not cartoons — the screen is the sound.

## 4. Broken-effects resolution (from the 2026-07-02 forensic report)

- **tape-echo:** the user-reported "fix canceled the effect" regression (`fe8c3ec`) was
  already re-fixed (`d747845`); HEAD is correct. No action.
- **flanger (the one real remaining bug):** bipolar LFO drives `delayTime` negative at
  Depth > ~6.7 (clamps → distorted sweep). Fix: positive base (~1 ms) + **unipolar**
  LFO adding `[0, depth]`, per the known-good `plus/flanger` approach. Focused test.
- **gate / octave (suspicious):** live audio probe (OfflineAudioContext wet-vs-dry
  energy check) after the UI pass lands; change only if the probe fails.

## 5. New effects (all six, each with bespoke art + viz + tests)

Per the gap analysis, in ROI order: **acoustic-sim** (body-resonance biquads, S),
**distortion** (hard-clip + pre/post EQ, S — curve referenced from js-rocks-research,
not touching that branch), **harmonizer** (second pitchshift worklet at +3/+5/+7 st +
mix, S–M), **uni-vibe** (4 staggered all-pass + unipolar LFO + throb, M),
**spring reverb** (chirped/dispersive IR + all-pass, M), **whammy** (ramped pitchshift
bend, M). Each registers normally (registry + PEDAL_TYPES + bespoke motif art per the
"effect art must be unique" rule + a viz entry + schema tests).

## 6. Verification

Full vitest + e2e green; a focused viz test (registry covers every registered type;
draw functions run without throwing on default params); before/after screenshots of
2–3 pedal screens (delay, drive, compressor) added to the demo set.
