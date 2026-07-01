# Neural Amp "Professional" Section — Design Spec

**Date:** 2026-07-01
**Maestro story:** 1a6577fd
**Status:** Approved design → implementation plan next
**Supersedes (engine choice):** `2026-07-01-neural-amp-design.md` chose a hand-rolled LSTM in
pure JS. A proof-of-concept (branch `nam-web-poc`, `poc/nam-web/`) instead validated the
**NAM WaveNet core compiled to WASM** — better tone, real captured amps, ~13% of one CPU core
single-threaded. This spec adopts that engine, delivered as a normal AudioWorklet on the app's
own AudioContext.

## 1. Goal

Add a **`05 Professional`** category to the existing sound browser containing 5 real captured
amps (Neural Amp Modeler `.nam` WaveNet models). Selecting one loads it into the user's
**current rig** exactly like any other preset — same pedalboard, recording, track patches. The
neural engine is **transparent**: the user experiences "more amps," not a different mode.

### Decided scope (v1)
- 5 amps: **Marshall JCM, EVH 5153, Fender Deluxe, Vox AC10, Roland JC** (WaveNet `.nam` from
  the POC's `poc/nam-web/models/`).
- Neural amp runs as a normal chain effect (`neuralamp`, amp-head type) on the app's **single**
  live `AudioContext` — no second context, no SharedArrayBuffer, **no COOP/COEP / no
  coi-serviceworker**.
- Reuses the existing pedalboard, chain state, buildChain, effect modules, recorder, presets.
- Adds an **input-channel selector (1/2)** to the app's live input (the app currently offers
  device-only; an interface's instrument input is often channel 2).

### Out of scope (v1)
- Saving user presets into the Professional category (the 5 are built-in).
- Cab-IR library (the captures already sound full; amp-only for now).
- Replacing the analytic amp / tube-amp work.
- Recording changes (recording already captures the live path automatically — see §7).
- Sample-rate conversion beyond what the NAM core's `Reset(sampleRate)` provides.

## 2. Why this architecture

The app builds every effect on one `AudioContext` (`src/main.js:641`) via `buildChain(ctx,…)`
(`src/engine.js:2`), and every effect module is `create(ctx, params)` — context-parameterized.
The prebuilt TONE3000 engine creates its **own** AudioContext (Emscripten "Wasm Audio Worklets")
and uses SharedArrayBuffer, so it cannot join the app's context or chain without a bridge
(latency) or a large refactor. Therefore we **rebuild** the NAM core as a plain single-thread
WASM run inside a **hand-written `AudioWorkletProcessor`** on the app's context. This makes the
neural amp a first-class effect: transparent, in-chain, recorded, no cross-origin isolation
needed. The POC proved the inference is fast single-threaded with SIMD (~0.34 ms per 128-block ≈
13% of one core), so no threading is required.

## 3. Engine — NAM core → plain WASM in a normal worklet

### 3a. Build (`tools/neural/` — build script, NOT shipped at runtime)
Adapt the POC's `poc/nam-web/bench/src/bench.cpp` (same NAM core, same
`-Os -flto -msimd128 -DNAM_USE_INLINE_GEMM -DNAM_SAMPLE_FLOAT` flags) into a small C API with
**no** `-sAUDIO_WORKLET` / `-pthread` (single-thread → no SharedArrayBuffer):

```c
int   nam_load(const char* jsonStr);          // build model from .nam JSON; 1 ok / 0 fail
void  nam_reset(double sampleRate, int maxBlock); // Reset+prewarm for the ctx sample rate
void  nam_process(float* inPtr, float* outPtr, int n); // process n (=128) samples in place
double nam_expected_sr(void);
```

Emscripten flags: `-sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH`
`-sSTACK_SIZE=32MB -sINITIAL_MEMORY=64MB -sEXPORTED_FUNCTIONS=_malloc,_free,_nam_load,_nam_reset,_nam_process,_nam_expected_sr`
`-sEXPORTED_RUNTIME_METHODS=ccall,cwrap`. Output: `assets/neural/nam.js` + `nam.wasm`.

**De-risk first (implementation step 0):** the one genuinely uncertain piece is instantiating
this Emscripten module **inside an `AudioWorkletGlobalScope`** and driving `nam_process` from the
worklet's `process()`. Spike this in isolation before building UI. If it proves impractical,
fall back (in priority order): (a) the POC's separate-view prebuilt engine on its own context
(reintroduces coi-serviceworker), or (b) the hand-rolled LSTM from the prior spec (LSTM-only).

### 3b. Runtime
```
src/effects/neuralamp.js                     schema + create() (amp-head effect)
src/effects/worklets/neural-amp-processor.js normal AudioWorkletProcessor: instantiate wasm,
                                             per-128-block nam_process, passthrough until ready
assets/neural/nam.wasm, nam.js               the compiled engine
assets/neural/<model>.nam                    the 5 amp captures
```

- `neural-amp-processor.js` receives the wasm bytes + a model's `.nam` JSON via `port.postMessage`
  (main thread `fetch`es them). It instantiates the module once, calls `nam_load(json)` then
  `nam_reset(sampleRate, 128)` (using the worklet's `sampleRate` global), and in `process()`
  copies the 128-sample input into the wasm heap, calls `nam_process`, copies out. **Runs
  passthrough (dry) until the model is loaded.** Allocation-free steady state (preallocated heap
  pointers), monomorphic — matches `pitchshift-processor.js`.
- `neuralamp.js` `create(ctx, params)`: constructs `AudioWorkletNode('neural-amp-processor')`,
  `fetch`es `assets/neural/nam.wasm` (cached) + `assets/neural/<model>.nam`, posts them, returns
  `{ input:node, output:node, apply }` (mono, matches the single-channel path). `apply(params)`
  sets trim/level (k-rate AudioParams) and, if `model` changed, posts the new `.nam`.

### 3c. Registration / integration (all additive)
| Change | File (from architecture map) |
|---|---|
| Register `neuralamp` | `src/effects/index.js:2-38` (one import + one array entry) |
| Load the worklet into every ctx | `src/effects/worklets/index.js:4-7` (add processor URL to `URLS`) |
| Make it a locked amp-head module | `src/chain-state.js:3` (`AMP_TYPES`) |
| New browser category + 5 presets | `src/presets.js:24-29` (`GB_CATEGORIES`) + `src/presets/pro-*.json` |
| Assets | `assets/neural/` (wasm + 5 `.nam`) |

A Professional preset = `{ name, category:'pro', chain:[{ type:'neuralamp', params:{ model, trim, level } }] }`.
Selecting it uses the existing `loadPreset → rebuildGraph` path (`src/main.js:324-338, 212-250`)
— **no new load path**. Switching amps = a fresh preset load → fresh worklet node with the new
model (no in-place swap race).

**Amp-head UI:** because `neuralamp` is an `AMP_TYPES` member it renders in the amp head, not as
a pedal. `src/chain-ui/amp.js` (`renderAmp`) needs a render case for `neuralamp` (amp name +
model selector + trim/level knobs), analogous to how it renders drive/eq/cabinet today. A
Professional preset's chain is typically just `[neuralamp]` in the head; pedals are added around
it normally.

## 4. Signal flow (unchanged app graph)
```
source(ch-selected) → analyser(tap) → calibrationEq → engine chain[ pedals + neuralamp(amp head) ]
  → reverbStage → normGain → gainOut → ctx.destination
```
All on the app's one `ctx`. Recorder taps `normGain` (`src/main.js:51`, `src/recorder.js`) → a
neural rig is captured automatically.

## 5. Input channel selector
Add a **1/2 channel selector** (+ optional per-channel meters) to the app's live input so the
guitar on an interface's channel 2 reaches the amp:
- `getUserMedia` at `src/main.js:636-640`: request `channelCount:2`.
- Insert a `ChannelSplitterNode(2)` after the `MediaStreamSource` (`src/main.js:652`) and route
  the selected channel into `calibrationEq`.
- UI: a small selector near the existing input `<select>` (`index.html:981`).
This benefits the whole app (fixes the "only one option" gap), not just Professional.

## 6. Sample rate
The app `ctx` runs at the hardware rate (often 44.1 kHz); NAM models are 48 kHz-native. The
worklet calls `nam_reset(sampleRate, 128)` with the real `ctx.sampleRate`; the NAM core handles
the rate internally (validated in the POC at 44.1 kHz). No app-side resampling.

## 7. Loudness normalization edge case
`src/normalize.js` renders the chain in an `OfflineAudioContext` to measure loudness. A neural
preset's worklet would need the wasm+model loaded in that offline ctx too (async), which offline
rendering can't easily await. **v1 decision:** skip offline loudness measurement for neural
presets — ship each Professional preset with a fixed, pre-measured `normDb` (the NAM core already
loudness-normalizes to −18 dB internally, so levels are consistent). Document this so the offline
path isn't silently fed an unloaded neural node.

## 8. Testing
- **Reuse** the POC perf bench (already proves ~13% core, single-thread).
- **Worklet-in-app functional test** (Playwright, headless — like the POC's `benchmark.mjs`):
  load a Professional preset, confirm the neural node produces finite, sustained non-silent
  output on the app ctx; confirm a pedal **before** and a pedal **after** the amp audibly change
  the output; switch between all 5 Professional amps with no page errors; confirm the input
  channel selector routes ch2.
- **Golden/parity (optional):** compare `nam_process` output against the POC bench wasm for the
  same model+input (both are the same core) to confirm the rebuild matches.

## 9. Risks
- **[High] wasm-in-worklet** (§3a de-risk step) — the load-bearing uncertainty; spike first.
- **[Med] Offline loudness** (§7) — handled by pre-measured `normDb`.
- **[Low] Model load latency** — brief dry passthrough while a `.nam` loads; acceptable.
- **[Low] Memory** — rebuild with modest `INITIAL_MEMORY` (64 MB), not the prebuilt's 1 GB.
