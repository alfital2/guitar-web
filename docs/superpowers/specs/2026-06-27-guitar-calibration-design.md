# Guitar Tone Calibration — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation plan
**Builds on:** the effects engine (`2026-06-27-amp-engine-design.md`). Reuses the
`{input, output, apply}` node interface and the `FakeAudioContext` test harness.

## Vision

Every guitar/pickup has a different tonal character, so one preset won't sound the
same on every instrument. Calibration captures a **tonal fingerprint** of the user's
clean guitar, derives a gentle corrective EQ that nudges it toward a **neutral
reference**, and applies that correction *before* the artist chain. Result: presets
land consistently across different guitars. Fingerprints persist per guitar.

This is the well-known "tone matching" idea (Positive Grid / Fractal), scoped to a
safe, musical, normalize-to-neutral correction.

## Scope decisions (locked during brainstorming)

- **Target = neutral reference** (normalize the guitar toward an even tonal balance;
  presets are authored for "neutral"). Not per-artist-guitar matching.
- **Capture = guided free play** (~12 s, "play across the whole neck"), with a live
  coverage meter that gates completion. Guided per-string is a future fallback.
- **Correction = gentle/capped/smoothed**, scaled by a **Strength slider** (0–100%).
  Not full-flatten; not tilt-only.
- **Storage = multiple named guitar profiles** in `localStorage`.

## Architecture & signal path

Calibration is a fixed first stage, independent of the artist preset chain:

```
source → [Calibration EQ] → engine.input → (artist chain) → engine.output → gainOut → destination
```

Swapping artist presets does not touch the calibration EQ. Swapping the active guitar
profile (or moving the Strength slider) only re-sets the calibration EQ's band gains.

New modules (separated from `effects/`):

- `src/calibration/analyzer.js` — accumulate captured audio into a fingerprint +
  coverage score. **Pure logic** (operates on frequency-bin arrays; no Web Audio).
- `src/calibration/correction.js` — fingerprint + reference + strength → per-band dB
  correction. **Pure logic.**
- `src/calibration/calibration-eq.js` — build the Web Audio EQ (N peaking
  `BiquadFilter`s) and `apply(correctionDb[])` to set gains. Conforms to
  `{ input, output, apply }`.
- `src/calibration/profiles.js` — `localStorage` CRUD for named profiles.
- `src/calibration/ui.js` — capture wizard, profile picker, strength slider.

## Band model

- **N = 10 log-spaced bands**, center frequencies spanning ~80 Hz → ~8 kHz.
- Defined once as a shared constant (used by analyzer, correction, and the EQ so the
  filters line up with the analysis bands).

## The fingerprint

- During capture, repeatedly read the analyser's frequency magnitudes and accumulate
  per-band average power.
- Convert each band's average power to dB: `bandDb[b] = 10*log10(power[b] + epsilon)`.
- **Normalize**: subtract the mean across bands → a *tonal shape* (relative balance),
  independent of overall loudness.
- Fingerprint = `Float array length N` (normalized band dB).

## Coverage metric (gates capture completion)

Coverage is NOT raw elapsed time. It combines:
1. **Band coverage:** fraction of the N bands that have received energy above a
   threshold at some point during capture.
2. **Duration:** a minimum capture time (≈8–12 s).
3. **Level:** adequate input level present (not silence).

`coverage = min(bandCoverageFraction, durationFraction)` with a level gate; capture's
**Done** action enables only when `coverage ≥ ~0.9`. If it stalls, the UI nudges the
user to play higher/lower notes.

## Correction math

Given the fingerprint and a neutral reference:

- **Reference:** flat normalized target — `target[b] = 0` for all bands (even balance).
- `rawCorrection[b] = target[b] - fingerprint[b]` (= `-fingerprint[b]`).
- **Smooth** across neighboring bands (e.g., 3-point moving average) to avoid jagged,
  resonant EQ.
- **Cap** each band to `[-6, +6]` dB.
- **Scale** by strength `s` (0..1): `correctionDb[b] = clampedSmoothed[b] * s`.

`s = 0` → flat correction (raw guitar). `s = 1` → full (capped) correction. Default
`s ≈ 0.65`.

## Calibration EQ

- Build N `BiquadFilter` nodes, `type: 'peaking'`, centered on the band frequencies,
  chained `input → f0 → f1 → … → fN-1 → output` (input/output are the first/last
  filter, or wrap in gains for a stable handle — implementer's choice, documented).
- `apply(correctionDb[])` sets each filter's `gain.value`.
- A correction of all-zeros (no profile, or strength 0) = transparent.

## Profiles (localStorage)

- Key e.g. `guitar-calibration-profiles` → JSON `{ profiles: [{ name, fingerprint, strength }], activeName }`.
- CRUD: `listProfiles()`, `saveProfile(name, fingerprint, strength)`,
  `getActive()`, `setActive(name)`, `deleteProfile(name)`, `setStrength(name, s)`.
- Robust to absent/corrupt storage (return empty list, never throw).

## UI / UX flow

- Always-visible: **guitar profile picker** (dropdown of saved profiles + "None"),
  a **Strength slider** (0–100%), and a **Calibrate** button.
- **Calibrate wizard:** instruction text ("play across the whole neck ~12 s"), live
  **coverage bar** + input level, **Done** (enabled at good coverage) and **Cancel**.
  On Done → prompt "Save as…" (name) → store profile, set active.
- Selecting a profile or moving Strength updates the calibration EQ live.
- An `AnalyserNode` taps `source` (read-only; not inserted in the audio path) for both
  capture and (optionally) the existing input meter.

## Integration with current app

- `main.js`: insert the calibration EQ between `source` and `engine.input`. On
  start, load the active profile and apply its correction. The artist-preset rebuild
  path is unchanged (it rebuilds from `engine.input` onward; calibration EQ persists).
- Reuses the input-meter analyser already added.

## Testing

- `analyzer` (pure): known frequency-bin input → expected normalized fingerprint;
  coverage logic (silence → low, full-spread → high).
- `correction` (pure): respects smoothing, ±6 dB cap, strength scaling; `s=0` →
  all-zeros; flat fingerprint → ~all-zeros correction.
- `calibration-eq` (fake AudioContext): builds N peaking filters at the band
  frequencies; `apply` sets gains; zeros → transparent.
- `profiles` (localStorage mock): CRUD round-trips; corrupt/absent storage → empty,
  no throw.
- Capture wizard + main.js wiring: browser glue, verified by ear.

## Out of scope (later)

- Guided per-string capture fallback mode.
- Non-flat / "musical" reference curves; multiple reference targets.
- Per-artist-guitar matching.
- Convolution/FIR matching (we use a banded peaking EQ).
- Exporting/sharing profiles.

## Success criteria

Calibrate a guitar (coverage gates a good capture), save it, and hear presets sound
more tonally consistent vs. raw. The Strength slider audibly scales the effect; 0 =
bypass. Profiles persist across reloads and switch instantly.
