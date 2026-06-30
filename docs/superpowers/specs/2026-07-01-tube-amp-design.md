# Tube Amp + Cabinet Simulation — Design Spec

**Date:** 2026-07-01
**Module type:** `tubeamp` (new chain effect, AudioWorklet-backed)
**Maestro story:** 7cf0fae2
**Status:** Approved design → implementation plan next

## 1. Goal

Replace the "generic synth pluck" tone produced by the current static `WaveShaperNode`
drive (`src/effects/drive.js`) with a guitar amp simulation that is *alive* and
touch-sensitive: harmonic content and compression that change with how hard the
player digs in. Must run real-time in-browser via Web Audio with a sub-10 ms
processing budget (it sits in the live monitoring path:
`source → calibrationEq → engine → reverb → out`, see `src/main.js`).

The defining limitation of the current chain is that `WaveShaperNode` is a
**memoryless** nonlinearity — a fixed transfer curve. Real tube amps have
*memory*: the operating point drifts with the signal (coupling-cap bias shift,
power-supply sag), so the same note sounds different soft vs. hard. A static
curve cannot do this. This design adds that memory using published, measured
techniques rather than ad-hoc tricks.

Default voice: **blackface clean → edge-of-breakup** (Fender-style: glassy clean
that blooms into light crunch when pushed). Other voices reachable via the gain /
tone-stack knobs.

## 2. Research basis (every DSP choice is cited)

| Stage | Technique | Primary source |
|---|---|---|
| Preamp nonlinearity | Dempwolf–Zölzer softplus-power triode law (fit to measured 12AX7), asymmetric → even+odd harmonics | Dempwolf & Zölzer, "A Physically-Motivated Triode Model for Circuit Simulations," DAFx-11, pp. 257–264. https://dafx.de/paper-archive/2011/Papers/76_e.pdf |
| Why not tanh | Symmetric sigmoids give odd harmonics only — circuit-wrong for a triode; even-harmonic mix = the "warm" tube character | Pakarinen & Yeh, "A Review of Digital Techniques for Modeling Vacuum-Tube Guitar Amplifiers," *Computer Music Journal* 33(2):85–100, 2009. DOI 10.1162/comj.2009.33.2.85 |
| Dynamic bias shift ("alive") | Asymmetric clip → signal-dependent DC offset → interstage **coupling-cap high-pass (stateful)** removes it dynamically → operating point of next stage shifts with playing | Yeh & Smith, "Simulating Guitar Distortion Circuits Using Wave Digital and Nonlinear State-Space Formulations," DAFx-08, §3.3–3.4. https://ccrma.stanford.edu/~dtyeh/papers/yeh08_dafx_sim.pdf |
| Anti-aliasing | First-order antiderivative anti-aliasing (ADAA-1) + 2× oversample = sweet spot | Parker, Zavalishin, Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution," DAFx-16. https://dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf |
| Tone stack | Exact '59 Fender Bassman 3rd-order transfer function → bilinear transform → direct-form IIR, recompute on knob-change | Yeh & Smith, "Discretization of the '59 Fender Bassman Tone Stack," DAFx-06. https://ccrma.stanford.edu/~dtyeh/papers/yeh06_dafx.pdf |
| Power-supply sag | Envelope-driven headroom modulation, grounded in rail RC (Thevenin 410 V / 593 Ω; τ from R·C) | Aiken, "What is Sag?" https://www.aikenamps.com/index.php/what-is-sag ; AmpBooks, "Digital Modeling of a Guitar Amplifier Power Supply." https://www.ampbooks.com/mobile/dsp/power-supply/ |
| Crossover distortion | Odd-symmetric waveshaper with small zero-crossing notch (subtle at clean, grows toward breakup) | Aiken, "What is Crossover Distortion?" https://www.aikenamps.com/index.php/what-is-crossover-distortion |
| Output transformer | Linear band-pass (~30 Hz HPF + HF roll-off); core saturation skipped (loud+bass only) | de Paiva, Pakarinen, Välimäki, "Real-Time Audio Transformer Emulation," EURASIP JASP 2011. https://link.springer.com/article/10.1155/2011/347645 |
| Cabinet | IR convolution (cab+mic ≈ LTI); keep ALL nonlinearity upstream (Wiener/Hammerstein decomposition) | Pakarinen & Yeh 2009 (above); Z² DSP, "Speaker Cab Modelling Part II." https://z2dsp.com/2018/07/10/impulse-response-modelling/ |
| Web Audio latency | Worklet adds only render quantum (~2.7 ms @48k); `ConvolverNode` ≈ zero algorithmic latency (leading section in RT thread) | W3C Web Audio "Convolution Architecture." https://www.w3.org/TR/2015/WD-webaudio-20151208/convolution.html ; Adenot, web-audio-perf. https://padenot.github.io/web-audio-perf/ |

## 3. Architecture

The **entire amplifier circuit runs inside one AudioWorklet**; the **speaker is a
native `ConvolverNode`** (cab+mic is LTI, so convolution is the empirically correct
and efficient model — and keeping the convolver native means the browser's
zero-latency partitioned implementation handles it).

```
src/effects/tubeamp.js              schema + create() — builds nodes, wires params
src/effects/worklets/tubeamp-processor.js   the amp circuit (process loop)
src/effects/worklets/tube-dsp.js    PURE, importable DSP math (unit-tested in node)
```

`tube-dsp.js` holds all pure functions (shaper, antiderivative table builder,
ADAA-1 evaluator, one-pole coeff helpers, tone-stack coefficient computation,
envelope/sag step). The processor `import`s it (module worklet — modern browsers
support ES `import` in `addModule`). `tube-dsp.js` is the unit-test target.

Registration:
- add `tubeamp-processor.js` URL to `src/effects/worklets/index.js` `URLS`
- add `tubeamp` to `src/effects/index.js` `mods`
- `loadWorklets(ctx)` is already awaited before `buildChain` in `src/main.js:639`
  and in `src/normalize.js` — `create()` constructs the `AudioWorkletNode` the same
  way `src/effects/pitchshift.js` does.

### Node graph built by `create()`

```
input(gain) → AudioWorkletNode "tubeamp-processor" → convolver(cab IR)
            → makeup(gain) → output(gain)
```

Cab IR loading reuses the pattern in `src/effects/jsrocks/cabinet.js`: fetch
`assets/jsrocks/cabinet/<ir>.wav` → `decodeAudioData` → cache per URL. **IR swap
must cross-fade between two convolver paths** (or prep the buffer ahead and swap on
a silent boundary) — assigning `.buffer` prepares the impulse on the main thread
and can drop a frame (Adenot; W3C). For v1, since cab changes are infrequent,
assigning `.buffer` on change is acceptable but MUST happen outside the audio-hot
moment; cross-fade is the documented upgrade if clicks appear.

## 4. Worklet signal flow (per render quantum, 128 frames)

The whole amp chain runs inside **one 2× oversample region**: upsample once at the
input, run every stage (nonlinear *and* linear) at 2× rate, decimate once before
the `ConvolverNode`. Upsample/decimate use a cheap half-band-ish FIR or polyphase
pair. This avoids any mid-chain rate change. ADAA-1 is applied to each
nonlinearity. The linear filters (coupling HPFs, tone stack, OT band-pass) simply
run at the oversampled rate `fs_os = 2·fs` — their coefficients are computed with
`fs_os`; running them at 2× is harmless (they're linear) and keeps the loop simple.

Per sample, all at `fs_os` between the single upsample and single decimate:

1. **Input drive** — `gain` knob scales signal into stage 1.
2. **Preamp stage 1** — Dempwolf shaper `f₁(x)` via ADAA-1 (table F0).
3. **Coupling HPF 1** — one-pole high-pass, real RC time constant (≈ stage
   coupling-cap + grid-leak). **Stateful** — this is what turns the asymmetric
   DC offset into a *dynamic* bias shift into stage 2.
4. **Preamp stage 2** — Dempwolf shaper `f₂(x)` via ADAA-1 (driven harder).
5. **Coupling HPF 2** — one-pole high-pass (DC block before tone stack).
6. **Tone stack** — Yeh-Smith 3rd-order IIR, coeffs from bass/mid/treble (Fender
   250 kΩ mid pot voicing), computed with `fs_os`. Recomputed only on knob-change,
   never per-sample.
7. **OT band-pass** — one-pole HPF ~30 Hz + gentle HF shelf/lowpass roll-off.
8. **Power stage** — odd-symmetric soft clip with a small zero-crossing notch
   (crossover), output ceiling scaled by **sag**: `ceiling = 1 − sagDepth · env`.
   `presence` = NFB-style high-shelf here.
9. **Sag envelope** — dual-time one-pole follower on |signal| (or signal²):
   τ_attack ≈ 3–10 ms, τ_release ≈ 30–150 ms. Drives the ceiling in step 8.
   Separate, genuine power-supply effect (distinct from the coupling-cap bias
   shift in steps 3/5).
10. **Output trim** — `master` / level.
11. *(decimate 2×→base rate, then → `ConvolverNode` cab)*

### Key DSP details

**Dempwolf shaper** (per stage, normalized to audio ±1 working range):
```
f(x) = G · ( (1/C) · log1p(exp(C · (x/μ + bias))) )^γ      − f(0)   // recentre so f(0)=0
```
with per-stage `G, C, μ, γ, bias`. γ in 1.2–2.5 (measured). Asymmetric → even
harmonics. Output scaled/clamped to a sane range. `log1p(exp(·))` computed in the
numerically-stable softplus form to avoid overflow at high drive:
`softplus(z) = max(z,0) + log1p(exp(−|z|))`.

**ADAA-1** (Parker 2016 eq. 9 + eq. 10 fallback):
```
if |x − xPrev| < tol:   y = f((x + xPrev)/2)              // midpoint, avoids 0/0
else:                   y = (F0(x) − F0(xPrev)) / (x − xPrev)
```
`tol ≈ 1e-5` (float32 buffers). `F0` = antiderivative of `f`. The Dempwolf shaper
has no closed-form antiderivative, so **build an F0 lookup table once at init**
(numerically integrate `f` over the working domain, e.g. [−10, +10] with fine
spacing) and interpolate (linear or cubic). State per stage: `xPrev` and cached
`F0(xPrev)`. ADAA-1 adds a 0.5-sample group delay and minor HF droop — the 2×
oversample largely undoes the droop.

**Coupling HPF (one-pole, stateful):**
```
y = a·(yPrev + x − xPrev);   a = RC/(RC + 1/fs_os)   // ~ first-order high-pass
```
Time constant set so the corner sits low (a few–tens of Hz) — high enough to block
DC and shift bias, low enough not to thin the tone.

**Tone stack** — Yeh-Smith continuous coefficients `b1..b3, a0..a3` from component
values (C1=0.25 nF, C2=C3=20 nF, R1=250 kΩ, R2=1 MΩ, R3=250 kΩ blackface mid,
R4=56 kΩ) and knob settings (t, m, l), then bilinear with `c = 2·fs`:
```
B0..B3, A0..A3 = (closed form from b*,a*,c)   // per yeh06_dafx eq. 2
normalize all by A0
y[n] = B0'x[n]+B1'x[n-1]+B2'x[n-2]+B3'x[n-3] − A1'y[n-1] − A2'y[n-2] − A3'y[n-3]
```
Unconditionally stable across the full knob range (all analog poles real). Recompute
on knob-change only; smooth knob values to avoid coefficient-jump transients.

**Sag** — `env = onepole(|x|, τ_attack, τ_release)`; `ceiling = 1 − sagDepth·env`;
power-stage clip uses `ceiling` as its drive ceiling. Perceptual approximation of
rail droop, grounded in the measured RC behavior (AmpBooks/Aiken).

## 5. Parameters (knobs)

Grouped for the amp-head UI (`src/chain-ui/amp.js` renders `amp-group` per module,
knobs per `schema.params`):

| Group | Param | Range | Default | Notes |
|---|---|---|---|---|
| PREAMP | `gain` | 0–10 | 3 | drive into stage 1 |
| PREAMP | `bias` | 0–10 | 5 | asymmetry / even-harmonic warmth |
| TONE | `bass` | 0–10 | 5 | tone-stack `l` |
| TONE | `mid` | 0–10 | 5 | tone-stack `m` (blackface scoop) |
| TONE | `treble` | 0–10 | 6 | tone-stack `t` |
| TONE | `presence` | 0–10 | 5 | power-amp NFB high-shelf |
| FEEL | `sag` | 0–10 | 4 | dynamic compression depth |
| POWER | `master` | 0–10 | 5 | power-amp drive / output |
| CAB | `cabinet` | 0–8 | 0 | IR index (reuse jr-cabinet CABS) |
| CAB | `level` | 0–10 | 5 | makeup gain |

Continuous params passed as **k-rate AudioParams**, **smoothed one-pole inside
`process()`** (k-rate stepping causes zipper noise — Adenot). Tone-stack params
(`bass/mid/treble`) trigger a coefficient recompute when their smoothed value
moves past a small threshold. `cabinet` change triggers IR load/swap on the main
thread side (in `apply`), not in the worklet.

## 6. Testing

Pure `tube-dsp.js` is unit-tested in node (mirrors `tests/dsp.test.js`,
`tests/cabinet.test.js`):

- **Shaper:** `f(0)=0` (after recentre), monotonic, finite for x∈[−10,10], visibly
  asymmetric (`f(a) ≠ −f(−a)` → even-harmonic content present).
- **F0 table / ADAA-1:** continuity across the midpoint-fallback branch (no jump at
  `|x−xPrev|=tol`), no NaN/Inf when `x==xPrev`, ADAA-1 output ≈ `f(x)` for slow
  (near-DC) input, alias energy on a high sine sweep lower than raw `f` (spectral
  check).
- **Coupling HPF:** blocks DC (step input decays to 0), low-freq corner as
  designed, stateful across blocks.
- **Tone stack:** coefficients finite and filter stable (poles inside unit circle)
  across the full `t/m/l` grid; flat-ish at noon; mid scoop present at `m` low.
- **Sag envelope:** fast attack / slow release step response within the spec'd τ
  range; `ceiling` stays in (0,1].

Worklet wiring + node graph covered like `tests/worklet-processors.test.js` /
`tests/amp.test.js`. `create()` returns `{ input, output, apply }` and survives a
context without `decodeAudioData`-able IRs (fallback: dry through if IR missing).

## 7. Honest tradeoffs / limits

- **ADAA-1 + 2× oversample**, not full circuit accuracy. Strong alias suppression
  at a fraction of 8–16× naive oversample cost; 0.5-sample delay + tiny HF droop.
  At very high gain ADAA's benefit shrinks (piecewise-linear input model weakens) —
  acceptable for a clean→edge voice.
- **Sag and crossover are perceptual approximations** (grounded in measured RC /
  measured harmonic data, but not SPICE-exact). Sag gives ~90% of the "feel" at a
  tiny fraction of the cost of a full cap-state ODE.
- **No grid-current branch / blocking distortion in v1** — that's a high-gain
  phenomenon; the clean→edge voice doesn't need it. Coupling-cap bias shift (the
  audible "bloom") IS modeled.
- **OT core saturation skipped** — only matters at loud + bass-heavy; expensive
  (hysteresis). Linear OT band-pass is modeled.
- **Cab IR captures only linear cab+mic** — correct by design; all nonlinearity is
  upstream. A single IR is valid at one drive level; speaker breakup is not modeled
  (would need a pre-convolver nonlinearity; out of scope).
- **Latency reality:** worklet adds ~2.7 ms (render quantum) + ~0 ms convolver. Sub-
  10 ms *round-trip* is achievable on macOS/iOS and good Windows (WASAPI ~10 ms),
  but **not** on Linux/PulseAudio (~30–40 ms) or Bluetooth — an OS/hardware limit,
  not a DSP one. Use `latencyHint: 'interactive'`, wired output.
- **CPU:** 2 shaper evals (table lookup) + 2 one-pole HPFs + 3rd-order IIR + power
  shaper + envelope, at 2× → tens of flops/sample. <1% CPU on modern hardware;
  `process()` must stay allocation-free (pre-allocated typed arrays, no object
  reshaping — Adenot).

## 8. Out of scope (YAGNI)

- Grid-current / blocking distortion, OT core saturation/hysteresis, speaker
  nonlinear breakup, ADAA-2 (dilogarithm cost), multi-channel/stereo amp,
  morphing "voice" knob across Fender/Vox/Marshall (the tone-stack R-values make
  this a later, easy extension — Marshall = 25 kΩ mid pot).
- Replacing/removing the existing `drive.js` / `cabinet.js` — `tubeamp` is added
  alongside; existing presets keep working.
