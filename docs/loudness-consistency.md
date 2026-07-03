# Loudness consistency overhaul (2026-07-02)

How preset loudness normalization was diagnosed, rebuilt, and gated. Code:
`src/normalize.js`, `src/main.js` (`scheduleNormalize`, `normSig`),
`src/effects/neuralamp.js`, `src/chain-ui/amp.js`. Audit:
`tests/loudness-audit.mjs` + `tools/loudness-audit.html`. Measurements:
`docs/loudness-report-before.json` / `docs/loudness-report.json`.

## 1. The problem

Switching presets changed perceived volume wildly. User-reported: the Fender
Deluxe neural preset was drastically louder than "Brit and Clean" — measured
gap **16.7 LU** (−5.8 vs −22.5 LUFS on identical guitar-like input, full chain,
after the app's own "normalization").

The pre-fix audit (all 60 presets, silent offline render, BS.1770-4 integrated
LUFS) quantified it:

| Metric (60 presets) | Before | After |
|---|---|---|
| Spread (loudest − quietest) | **25.5 LU** (Fender Deluxe −5.8 vs Roland JC −31.4) | **1.9 LU** |
| Worst deviation from median | 13.2 LU | **1.3 LU** |
| Median | −18.2 LUFS | −19.5 LUFS (target −18) |
| Render errors | 0 | 0 |

25 LU is far past "annoying" — it is the difference between background level
and painful, and it lived *inside one preset browser*.

## 2. Root causes found

Five independent faults, each sufficient to break consistency on its own:

1. **Dead stale-guard — the measured gain was never applied.** After the async
   offline measure, `scheduleNormalize` re-checked that the chain hadn't
   changed by comparing the bare `chainState.signature(currentChain)` against a
   signature that had a `|rv<size>,<mix>` reverb suffix baked in. The strings
   could never be equal, so `normGain` was never written. Normalization had
   been a silent no-op for months (see the NOTE at the guard in
   `src/main.js:548`).

2. **Type-only signature skipped re-measure across preset loads.**
   `chainState.signature` is types + bypass only — correct for skipping knob
   turns, wrong as a preset-load key. All five neural amp presets share the
   signature `neuralamp`, so after the first one measured, the other four never
   re-measured: a stuck **0.170 linear gain** (−15.4 dB — right for the
   Marshall JCM) was reused for every model, including the Roland JC, which
   actually needs a **+11 dB boost**. Fix: every load path (`loadPreset`,
   `loadTrackPatch`, `loadStoredChain`) nulls `normSig` before rebuilding.

3. **Two uncalibrated systems.** Pro neural presets carried a hand-tuned
   `normDb` applied via a separate path while everything else used the
   measured path. The hand values were wrong by **−7 to +11.8 dB** versus what
   measurement gives (Fender Deluxe ~7 dB too hot; EVH 5153 11.8 dB too
   quiet). `normDb` is removed; `tests/pro-presets.test.js` asserts it stays
   dead.

4. **Pink-noise proxy failure.** The old reference signal was pink noise. Amps
   are nonlinear: equalizing pink-noise RMS demonstrably does not equalize
   loudness on plucked-transient material — the audit measured a **~15 LU
   spread** across presets that pink normalization considered "equal".

5. **False "neural can't render offline" assumption.** Neural (wasm-worklet)
   chains were excluded from measurement entirely on the belief that the
   worklet couldn't run in an `OfflineAudioContext`. It can: the wasm→model
   handshake completes over the worklet port *before* `startRendering()`
   (verified by the audit — all 5 neural presets render offline with 0 errors).

## 3. The new design

One measured path for every chain, analytic or neural (`src/normalize.js`):

- **Reference signal**: 3 s of deterministic Karplus-Strong guitar (two E-minor
  strums + three single notes, fixed seed, −12 dBFS peak) — what the
  instrument actually produces, not a noise proxy.
- **Measurement**: silent `OfflineAudioContext` render of the full chain
  (pedalboard + amp modules + the post-pedalboard amp reverb stage), then
  integrated loudness per **ITU-R BS.1770-4** (two-stage K-weighting, 400 ms
  blocks, −70 LUFS absolute / −10 LU relative gating).
- **Target**: `TARGET_LUFS = −18` (≈ the pre-fix median, so overall app volume
  is unchanged — just consistent). The correcting gain is clamped to ±24 dB
  (×16 / ×0.06) and falls back to exactly unity on any failure (no offline
  context, silent render, handshake timeout) — never a wild guess.
- **Neural offline handshake**: `neuralamp.create()` tags its lifecycle
  `CustomEvent`s (`neural-amp-loading/ready/error`) with `{offline:true}` when
  its context is offline. `normalize.js` awaits *its own* render's readiness
  before `startRendering()`; `src/chain-ui/amp.js`'s tube warm-up UI filters
  to live-tagged events only, so silent measures never flash the amp head.

**When re-measure happens** (`scheduleNormalize`, debounced 150 ms, stale-guard
now compares the same composite signature):

- Preset / per-track patch / persisted-chain loads — always (`normSig = null`),
  since two presets can share a structure yet differ hugely in level.
- Chain structure changes: add / remove / move / bypass (signature change).
- Amp reverb size or mix (folded into the signature — wet mix is loudness).
- The neural **`model` param** — special-cased in `setParamLive`: it is not a
  knob, it swaps the whole captured amp (inherent levels vary by 10+ dB), so
  it is treated like a preset change.

**When deliberately NOT**: ordinary knob turns. A volume/drive/level knob is
*supposed* to change loudness; re-normalizing would fight the player. Param
edits keep the signature, so they never trigger a measure.

## 4. Verification

`tools/loudness-audit.html` renders **every preset in every browser category**
through its complete chain *plus the app's exact normalization code path*
(`measureLoudnessGain` itself supplies the gain), against a 5 s verification
signal that is deliberately different from the calibration reference
(different seed, A-major instead of E-minor, longer) — a pass means presets
are consistent on guitar-like material in general, not just on the signal they
were calibrated with. `tests/loudness-audit.mjs` drives it in headless
Chromium; everything is 100% silent.

- `npm run audit:loudness` — report mode: per-preset table (LUFS, Δmedian,
  applied gain, unclamped gain, peak, CLAMPED/CLIP flags) and writes
  `docs/loudness-report.json`.
- `npm run test:loudness` — gate mode: **fails** if any preset deviates more
  than ±1.5 LU from the cohort median, if any preset errors, or if the median
  itself drifts more than ±3 LU from −18.

Tolerance semantics: *consistency* is judged against the median, not the
absolute target, because the calibration-vs-verification signal difference
introduces a small constant bias that shifts every preset equally; the median
is separately *anchored* (±3 LU to −18) so whole-app level drift still fails.

Post-fix result: **all 60 presets within ±1.3 LU of the median, spread
1.9 LU, 0 errors** — gate passes. Applied gains now span −15.4 dB (Marshall
JCM) to +11.0 dB (Roland JC), i.e. the correction really is per-preset.

Four suites cover the system: `npm test` (unit: `normDb` stays dead, unified
neural/analytic fallback, chain-state signature), `npm run test:probe`
(per-effect DSP probes), `npm run test:e2e` (live-context checks that per-amp
normalization actually lands — gain-ratio between models, spectral
distinctness since post-fix RMS can no longer discriminate amps), and
`npm run test:loudness` (the regression gate above).

## 5. Known limitations

- **Reverb IR wobble (~0.3 dB)**: the reverb impulse is `Math.random()`-seeded,
  so back-to-back measures of the same chain differ by a few tenths of a dB.
  The audit's CLAMPED flag uses a 0.5 dB threshold to avoid false positives.
- **Saw-vs-guitar RMS in e2e**: `test:e2e` feeds a sawtooth, whose RMS
  behavior differs from plucked material — it verifies normalization *lands*
  (direction and ratio), not absolute LUFS; absolute numbers belong to the
  audit.
- **Calibration/verification bias (~1.5 LU)**: the post-fix median is −19.5,
  not −18.0, because the two signals excite nonlinear chains slightly
  differently. Constant across presets; handled by median-relative gating.
- **First neural measure costs a wasm compile (~1–2 s)**: each offline
  measure spins up a fresh worklet; the first one also compiles the NAM wasm.
  The measure is async and debounced so the UI never blocks, but the corrected
  gain lands slightly later on the first neural preset load (timeout budget:
  20 s in-app, 30 s for the audit's first neural render).
