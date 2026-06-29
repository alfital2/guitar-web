# Audio QA harness

Objective sound-quality testing for the effects engine. We can't *listen* to the
output from code, so instead we **render every preset offline and measure it** —
catching the problems that are otherwise only audible: endless echo / runaway
feedback, silence, NaN blowups, DC offset, and gross gain-staging clipping.

## How it works

1. **`signal.js`** — generates a deterministic plucked-string test riff
   (Karplus-Strong), followed by a few seconds of silence so the effect *tail*
   can be measured after the input stops.
2. **`run.mjs`** — serves the repo and drives headless Chrome over the DevTools
   protocol. For each preset it:
   - measures the loudness-normalization gain (`measureLoudnessGain`, same as the
     live app),
   - drives the chain at that reference level,
   - renders `chain -> normGain` in an `OfflineAudioContext` (the real heard
     path), then
   - runs **`metrics.js` → `analyze()`** on the rendered buffer.
3. **`metrics.js`** — pure functions (`peak`, `rms`, `analyze`, …) that turn a
   rendered buffer into a verdict. Unit-tested in `tests/audio-qa.test.js`.

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `fail`  | NaN/Inf, silence, or **runaway feedback** (tail energy growing) |
| `warn`  | **endless echo / long tail** (tail not decaying), gross clipping, or DC offset |
| `ok`    | tail decays, no blowups |

The tail is the energy *after* the input stops. A healthy effect decays to
≈ −120 dB or lower; an endless-echo bug holds the tail near 0 dB.

### Why clipping uses a high threshold here

The render is **loudness-normalized** and driven by a high-crest plucked signal,
so transient peaks legitimately exceed 1.0 — even a *bypassed clean* chain peaks
around 1.4. That isn't clipping (Web Audio is float internally; clipping only
happens at the DAC). So the runner passes `clipThresh: 2.5` to flag only genuine
gain-staging blowups, not normal transients.

## Running

```sh
node tools/audio-qa/run.mjs                 # all presets
node tools/audio-qa/run.mjs "Echo Studio"   # only presets whose name matches
npx vitest run tests/audio-qa.test.js       # unit tests for the metrics
```

Requires Google Chrome or Chromium installed.

## A bug this caught

The tape-echo feedback loop ran its repeats through a soft-clip saturator whose
*small-signal* gain is ≈ 5.5×. Inside the loop that multiplied the feedback gain,
so quiet repeats **grew** instead of decaying — an endless wash (Echo Studio,
Ambient Wash). Fix: compensate the in-loop saturator to unity small-signal gain
so it only softens loud repeats and feedback stays < 1. See
`src/effects/tape-echo.js`.
