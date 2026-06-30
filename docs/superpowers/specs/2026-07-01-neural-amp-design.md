# Neural Amp (Captured-Amp LSTM) — Design Spec

**Date:** 2026-07-01
**Module type:** `neuralamp` (new chain effect, AudioWorklet-backed) + offline training pipeline
**Maestro story:** 7cf0fae2 (amp R&D)
**Status:** Approved design → implementation plan next
**Companion spec:** `2026-07-01-tube-amp-design.md` (the analytic chain — ships as the default/generic engine; `neuralamp` is the per-amp authentic engine, both coexist in the registry)

## 1. Goal

Capture a *specific real amp* and run it in-browser, real-time, on the user's own
machine (no server). This is the one thing a neural model does that the analytic
chain cannot: reproduce a named device's idiosyncratic nonlinearity and dynamic
feel to the point of being indistinguishable in a blind test (Wright et al. 2020).

Decided scope (v1):
- **Engine:** hand-rolled LSTM forward pass in the AudioWorklet (no Emscripten).
- **Capture:** amp head / DI (preamp+power, no cab) → keep `ConvolverNode` cab IR
  separate (cab stays LTI, swappable — matches the analytic chain structure).
- **Parametric scope:** non-parametric — one capture, one amp setting, one model.
  Conditioning (gain/tone knobs) is a documented later extension.

## 2. Why this architecture (cited)

| Choice | Why | Source |
|---|---|---|
| Single-layer LSTM, hidden 16–40 | Per-sample, stateful, no added latency; ~50–310 MMAC/s → comfortable in WASM/JS on modern CPU. Reaches WaveNet-comparable ESR at a fraction of the compute; "transparent" blind-test results sit around hidden 96 | Wright, Damskägg, Välimäki, "Real-Time Black-Box Modelling with Recurrent Neural Networks," DAFx-19. https://dafx.de/paper-archive/2019/DAFx2019_paper_43.pdf |
| Residual connection (`y = lstm(x) + x`) | Network predicts the small correction over the dry signal → smaller net reaches higher quality | Wright et al., "Real-Time Guitar Amplifier Emulation with Deep Learning," Applied Sciences 10(3):766, 2020. https://www.mdpi.com/2076-3417/10/3/766 |
| ESR loss + pre-emphasis `H(z)=1−0.95z⁻¹` | Standard amp-modeling loss; pre-emphasis weights the perceptually-important highs | Wright et al. 2020 (above); Koker reimpl. https://teddykoker.com/2020/05/deep-learning-for-guitar-effect-emulation/ |
| ~3 min reamped training audio, residual LSTM | Sufficient for transparent amp capture | Wright et al. 2020; NAM training paradigm. https://github.com/sdatkinson/neural-amp-modeler |
| Hand-rolled LSTM (not RTNeural/WASM) for hidden≤40 | The forward pass is tiny (4·H·(in+H) MACs/sample); avoids the Emscripten toolchain, fully unit-testable, matches existing worklet pattern (`pitchshift-processor.js`) | RTNeural exists as the heavier alt. https://github.com/jatinchowdhury18/RTNeural |
| Cab as separate `ConvolverNode` IR | Cab+mic is LTI; keep it out of the NN so the NN only learns the (nonlinear) amp, and cabs stay swappable | Pakarinen & Yeh 2009 (Wiener/Hammerstein decomposition); see tube-amp spec §2 |
| In-worklet single-thread WASM/JS inference, no SharedArrayBuffer | Proven shipping path (NAM web player); single-thread sidesteps COOP/COEP cross-origin isolation | TONE3000 NAM web player (C++→WASM in AudioWorklet). https://github.com/tone-3000/neural-amp-modeler-wasm ; in-worklet LSTM latency mean ~5 ms / p95 9 ms: https://workadventu.re/tech/building-an-easy-to-use-browser-noise-suppression-library-in-an-audio-worklet/ |

## 3. Architecture

Two halves.

### 3a. Offline training pipeline — `tools/neural-amp-training/` (Python, NOT shipped to the browser)

```
capture.md         instructions + a standardized ~3-min dry input .wav to reamp
align.py           time-align + level-normalize the recorded (dry, amped) pair
train.py           PyTorch single-layer LSTM, residual, ESR+pre-emphasis loss
export.py          state_dict → assets/neural/<model>.json (Float32 weight arrays + meta)
golden.py          run trained model on N samples → tests/fixtures/<model>.golden.json
```

- Input = the standardized dry guitar file (reuse NAM's public input or our own).
- Process: user reamps the input through the real amp head/DI at one setting,
  records the output, runs `align.py` (cross-correlation latency align + peak
  normalize), `train.py` (truncated BPTT, Adam, train to an ESR target, e.g. <5%
  good / ~1–2% excellent), `export.py`.
- **Export JSON schema** (small — hidden-40 ≈ ~7k params):
  ```json
  { "type": "lstm", "hidden": 40, "inSize": 1, "sampleRate": 48000,
    "residual": true,
    "W": [...4H*inSize], "U": [...4H*H], "b": [...4H],
    "Wout": [...H], "bout": 0.0,
    "gateOrder": "ifgo" }       // PyTorch packs gates as [i,f,g,o]
  ```
- **Golden vector** (`golden.py`): the same trained model run on a fixed input
  sequence, saved as `{input:[...], output:[...]}`. The JS unit test replays it and
  asserts JS inference == Python within tol (1e-4). This is the load-bearing
  correctness guarantee that browser inference matches the trained model.

### 3b. Runtime — browser module

```
src/effects/neuralamp.js                    schema + create() (worklet node + cab + loads weights)
src/effects/worklets/neural-amp-processor.js  per-sample LSTM loop, allocation-free
src/effects/worklets/lstm.js                  PURE LSTM math (importable, unit-tested)
assets/neural/<model>.json                  exported weights
```

Node graph from `create()`:
```
input(gain/trim) → AudioWorkletNode "neural-amp-processor" → convolver(cab IR)
                 → makeup(gain) → output(level)
```
- Registration: add the processor URL to `src/effects/worklets/index.js`, add
  `neuralamp` to `src/effects/index.js`. `loadWorklets(ctx)` already awaited before
  `buildChain` (`src/main.js:639`).
- Weights load: `create()` (or `apply`) fetches `assets/neural/<model>.json` and
  `port.postMessage`es the typed weight arrays to the worklet. The processor runs
  **passthrough (dry) until weights arrive**, then switches to LSTM inference.
- Cab IR: reuse the `jr-cabinet` fetch/cache/`decodeAudioData` pattern; cross-fade
  on cab change (per tube-amp spec).

## 4. LSTM forward pass (per sample, in the worklet)

State `h[H]`, `c[H]` persist across `process()` calls (preallocated typed arrays,
never reallocated). For each input sample `x` (scalar; vector if conditioned later):

```
for k in 0..H:   // gate pre-activations: a = W·x + U·h_prev + b, gates packed [i,f,g,o]
   i = σ(Wi[k]*x + Σj Ui[k][j]*h[j] + bi[k])
   f = σ(Wf[k]*x + Σj Uf[k][j]*h[j] + bf[k])
   g = tanh(Wg[k]*x + Σj Ug[k][j]*h[j] + bg[k])
   o = σ(Wo[k]*x + Σj Uo[k][j]*h[j] + bo[k])
   c[k] = f*c[k] + i*g
   hNew[k] = o*tanh(c[k])
y = Σk Wout[k]*hNew[k] + bout
if residual: y += x
h ← hNew
```

Cost = `4·H·(inSize+H)` MACs/sample. H=40,in=1 → ~6.6k MAC → ~315 MMAC/s @48k.
Implementation notes for real-time JS:
- Flat `Float32Array` weight matrices, manual indexed loops, **monomorphic**
  function (no object shapes mutated mid-render — Adenot).
- No allocation in `process()`; `hNew` is a preallocated scratch buffer.
- `σ(x)=1/(1+exp(-x))`, `tanh` via `Math.tanh`.
- Sample-rate: v1 assumes `ctx.sampleRate === model.sampleRate`; if mismatched,
  warn and fall back to passthrough (resampling is future work).

## 5. Parameters (knobs)

| Group | Param | Range | Default | Notes |
|---|---|---|---|---|
| AMP | `model` | (enum) | 0 | which captured `.json` to load |
| AMP | `trim` | 0–10 | 5 | input gain into the model (5 = unity = capture level; deviating pushes the captured nonlinearity harder — musical but off-capture) |
| CAB | `cabinet` | 0–8 | 0 | IR index (reuse jr-cabinet CABS) |
| CAB | `level` | 0–10 | 5 | makeup gain |
| OUT | `mix` | 0–1 | 1 | dry/wet (for parallel blends) |

Continuous params = k-rate AudioParams, one-pole smoothed in `process()`.

## 6. Testing

- **`lstm.js` golden-vector test (critical):** load `tests/fixtures/<model>.golden.json`,
  run JS LSTM on its input, assert max abs error vs Python output < 1e-4. Proves
  browser inference == trained model.
- **`lstm.js` unit tests:** gate math sanity (σ/tanh ranges), state persistence
  across calls, residual on/off, output finite for ±1 input.
- **Worklet wiring** (mirror `tests/worklet-processors.test.js`): node builds,
  passthrough before weights, switches to inference after `postMessage`.
- **`create()`** returns `{input, output, apply}`, survives missing weights/IR
  (passthrough/dry fallback).
- **Pipeline (Python)** is validated by the golden vector + the ESR achieved at
  train time (logged, not a JS test).

## 7. Honest tradeoffs / limits

- **One model = one rig + one setting.** Non-parametric v1. The `trim` knob pushes
  the captured curve harder/softer but that is *extrapolation* off the capture
  point, not a true gain control. Gain/tone conditioning (concatenate knob values
  into the LSTM input, capture multiple settings — Schmitz & Embrechts 2018;
  PANAMA 2025) is the documented next step.
- **CPU / weak hardware:** per-sample recurrence is sequential (can't vectorize
  across time). hidden≤40 is fine on modern CPUs; old/low-power laptops may glitch.
  Mitigation: keep `neuralamp` optional, provide bypass + fall back to the analytic
  amp. WASM-SIMD is the upgrade path if pure JS is too slow.
- **Sample-rate lock:** v1 requires engine SR == training SR; mismatch → passthrough
  + warn. Capture at the engine's SR (48 kHz default).
- **Capture quality ceiling:** the model is only as good as the reamp (alignment,
  noise, DI quality). Garbage capture → garbage model. `align.py` handles latency +
  level; the user must provide clean reamped audio.
- **No aliasing model needed in the NN** — the LSTM learns the band-limited I/O of
  the captured device directly (unlike the analytic waveshaper which needs ADAA).
- **Cab is separate** — the NN models the amp head only; the perceived cab comes
  from the IR. If the user captures full-rig instead, the IR stage is bypassed
  (out of scope for v1, which captures head/DI).

## 8. Out of scope (YAGNI for v1)

- Knob conditioning (gain/tone), multi-setting capture, active-learning capture
  selection (PANAMA), WaveNet/NAM-standard architectures, RTNeural→WASM,
  SharedArrayBuffer/Worker inference, WebGPU, in-browser *training*, sample-rate
  conversion, loading community `.nam` files. Each is a clean later extension.
- Replacing the analytic amp — `neuralamp` is added alongside it.
