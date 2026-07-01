# Code + performance review — 2026-07-01

Vanilla-JS Web Audio guitar app (~6k LOC). Review by 3 parallel agents (core/state,
effects/DSP, UI/render) + first-hand check of `engine.js` / `main.js`. Scope: real
problems only — correctness bugs, audio-thread starvation, AudioNode/oscillator leaks,
DOM thrash. Style nits excluded.

> ⚠️ During the review a concurrent Claude session in this repo ran a `git checkout`/`clean`
> that deleted the untracked `src/effects/jsrocks/`, `src/effects/plus/`, and
> `src/presets/jsrocks.js` from the working tree. Those live on branch `js-rocks-research`
> (@ `76364c2`). The effect-triplication item below is THAT session's territory — coordinate,
> don't touch.

---

## Findings (ranked)

### HIGH

#### 1. Oscillator/source leak on every chain edit
**Files:** `src/engine.js` (whole), `src/main.js:212` `rebuildGraph()`
`rebuildGraph()` tears down the old engine with only `engine.output.disconnect()` (and
`calibrationEq.output.disconnect()`). The per-effect internal nodes are never disconnected,
and — critically — the 9 LFO effects call `osc.start()` and never `stop()`:
`chorus, flanger, phaser, vibrato, tremolo, rotary, autopan, ringmod, tape-echo`.
`rebuildGraph` runs on **add / remove / move / bypass-toggle**, so every chain edit
abandons a still-running `OscillatorNode` (and any `ConstantSourceNode`). They never GC
because a running source stays alive. CPU + memory climb for the whole session.
Verified first-hand: see `tremolo.js` — `osc.start()` at create, no teardown returned.

**Fix:** Introduce a teardown contract.
- Each effect `create()` returns `destroy()` in addition to `{input, output, apply}`.
  `destroy()` stops every started source and disconnects every node it made.
- `buildChain` aggregates module `destroy` fns and exposes `engine.destroy()`.
- `rebuildGraph` calls the OLD `engine.destroy()` before reassigning `engine`.
- Effects with no sources can omit `destroy` (engine guards with `?.`).

#### 2. Live-record waveform redraw is O(n²)
**Files:** `src/recorder.js:53` `samplesSoFar()`, `src/main.js:855` `grow()`
`samplesSoFar()` calls `concatChunks()` — allocates a fresh `Float32Array` and copies
*every* captured chunk. The live `grow()` loop calls it ~20 fps and `drawWaveform`s the
whole buffer. Cost grows O(n²) over take length; heavy GC on the main thread while the
deprecated `ScriptProcessor` recorder also runs there → audio dropouts on long takes.
**Fix:** Maintain a running concatenated buffer (append chunk on capture), and draw only a
decimated tail (or downsample to canvas width) instead of re-concatenating + redrawing all.

#### 3. Tuner runs heavy pitch detection at 60 fps
**File:** `src/tuner.js:42`
rAF loop runs `detectPitchMPM` (O(n·maxLag) NSDF, fftSize 4096) **every frame**, allocating
a fresh `Float32Array(maxLag+1)` per frame plus a median sort. This is exactly the work the
meter loop explicitly throttles to ~13 Hz (`main.js:511-515` comment: "far too heavy to run
at 60 fps; it can starve the audio render thread and cause playback dropouts"). Tuner ignores
that lesson.
**Fix:** Gate detection to ~13–20 Hz via `performance.now()` (mirror `startMeter`), and reuse
a preallocated NSDF buffer instead of allocating per frame.

### MED

#### 4. WaveShaper curves rebuilt on every knob drag
**Files:** `src/effects/drive.js:37`, `fuzz.js:23`, `octave.js:31-32` (two curves),
`gate.js:36` (+ jsrocks/plus variants when wired)
`engine.setParam` calls `apply(m.params)` with the FULL param object on any knob change, so
`apply` rebuilds its `Float32Array` distortion curve even when an unrelated knob (tone/level)
moved. jsrocks `distortion.js` rebuilds a ~sampleRate-length (~48k float) curve per frame.
`reverb.js:22-28` is the correct pattern — guards on `lastSize`.
**Fix:** Cache each curve's source-param last value; rebuild only on change. Drop curve length
to ~2048 where full sampleRate isn't needed.

#### 5. `toggleBypass` does a full DOM rebuild
**File:** `src/main.js:303` → `rebuildGraph()`
Toggling one footswitch wipes + rebuilds the entire pedalboard AND amp DOM
(`renderPedalboard`/`renderAmp` both `innerHTML=''`). The audio rebuild is justified (chain
skips bypassed nodes); the dual full-subtree DOM rebuild is not — bypass only changes one
pedal's `.bypassed` class + LED + `aria-checked`.
**Fix:** Toggle class/attrs on the existing `.pedal` node; rebuild only the audio graph.

#### 6. `track-lane` full rebuild + waveform redraw per edit
**File:** `src/track-lane.js:191,220-253`
`renderTrackLane` does `container.innerHTML=''` and re-runs `drawWaveform` for every clip on
every edit (mute/solo/move/trim/rename/arm/add).
**Fix:** Diff/patch clips, or at least skip `drawWaveform` for clips whose samples/offset/len
are unchanged.

#### 7. Metronome timers/oscillators not cancelled on stop
**File:** `src/metronome.js:33-42,51,59,78`
`onBeat`/`onDownbeat` fire via `setTimeout` that `stop()` never clears; `click()` schedules
oscillators ahead that `stop()` doesn't cancel. A scheduled count-in `onDownbeat` (which
starts recording) still fires after `stop()` — only `main.js`'s `begin()` ctx-guard
accidentally saves it.
**Fix:** Track pending timeout IDs + scheduled oscillators; clear/stop them in `stop()`.

#### 8. Player nodes not disconnected; second AudioContext never closed
**File:** `src/player.js:25,72-77`
Playback `AudioContext` is created lazily and never closed; `stop()` stops sources but leaves
per-track gain/pan nodes connected to `destination`. Also `ctx.resume()` is async but
`t0 = currentTime + 0.06` + `s.start()` schedule immediately — if resume takes >60 ms the
head of playback clips.
**Fix:** `disconnect()` gain/pan nodes in `stop()`; suspend/close ctx when idle; await
`resume()` before computing `t0`.

#### 9. Flanger LFO drives delayTime negative (correctness)
**File:** `src/effects/flanger.js:27,38`
Base delay `0.002`s, LFO swing up to `±0.003`s → modulated `delayTime` reaches `-0.001`,
which Web Audio clamps to 0 → asymmetric/distorted sweep at higher Depth. The deleted
`plus/flanger` already fixes this with a unipolar LFO over a positive base.
**Fix:** Unipolar LFO, or raise base delay above the max sweep.

### LOW (noted, not urgent)

- `chain-ui/pedalboard.js:124-130` — FLIP loop interleaves layout reads/writes → N forced
  reflows per `pointermove` during a pedal drag. Batch reads, then writes.
- `preset-browser.js:51,69` — `paintPatches()` rebuilds full button list on every keystroke.
  Debounce or filter via `hidden`.
- `effects/worklets/pitchshift-processor.js:53` — two `Math.sin` per sample in render loop.
  Precompute a half-sine window LUT.
- Meter/tuner/calib rAF loops not gated on `document.hidden` (rely on browser throttle; they
  DO stop on explicit paths — no permanent leak). Optional: pause on `visibilitychange`.
- `track-lane.js:18` — `selection` is a module-level singleton `Set`, not per-lane instance.
  Fine while one lane is mounted.
- `main.js:639` — `loadWorklets(ctx)` only awaited in Start flow; adding a pitchshift/looper
  effect before it resolves would throw in `new AudioWorkletNode`. Guard construction.
- `jsrocks/time.js:64` / `jsrocks/cabinet.js:43` — IR cache keyed by URL only; reuse across a
  44.1k live ctx and a 48k offline-normalize ctx mismatches sampleRate. Key by `url+sampleRate`.

---

## Verified non-issues (checked, OK — don't "fix")

- Playback `onTick` only mutates `playhead.style.left` → playback does NOT rebuild the lane.
- Undo `snapshot()` taken before in-place mutations; shallow take-copies preserve pre-edit values.
- `rebuildGraph` DOES disconnect `calibrationEq.output` + old `engine.output` (the leak is the
  *internal/oscillator* nodes, not output accumulation).
- `scheduleNormalize()` re-checks chain signature after its async offline render → race-safe.
- Per-knob changes do NOT re-render DOM (`setParamLive`/`onAmpParam` update audio + the knob's
  own SVG only).
- `add`/`remove`/`move` full re-renders are structural and acceptable; only `toggleBypass` (#5)
  is the avoidable one.
- No rAF loop runs forever — all four (`rafId`, tuner raf, `calibRAF`, `liveRAF`) have cancel
  paths. The meter loop already throttles pitch detection correctly.

---

## Refactor plan

**Do now (this story — correctness/perf, small surface):**
1. `destroy()` teardown contract → fixes #1 (highest payoff). Engine + per-effect + `rebuildGraph`.
2. Curve-rebuild guard helper → fixes #4 across WaveShaper effects.
3. Throttle tuner to ~15 Hz + preallocated buffer → fixes #3.
4. Cancel metronome timers/oscillators in `stop()` → fixes #7.

**Do soon (structural, medium):**
5. Bypass in-place DOM toggle (#5).
6. Live-record running buffer + decimated draw (#2).
7. Player node disconnect + ctx lifecycle + await resume (#8).
8. Flanger unipolar LFO (#9).

**Defer (bigger / cross-session):**
9. Split `main.js` (945-line god module: audio graph + track model + undo + clipboard +
   calibration + metering + transport) into `audio-graph` / `track-controller` /
   `transport-controller` / `calibration-controller`.
10. Recording → AudioWorklet + ring buffer (kills deprecated ScriptProcessor, fixes #2 cleanly).
11. Effect triplication (originals vs `jsrocks/jr-*` vs `plus/*-plus`): collapse to one impl per
    effect — **this is the `js-rocks-research` session's work. Coordinate, don't touch.**

**How to test #1:** Start app, DevTools Performance/Memory. Add+remove a pedal 20×. Watch
AudioContext node count / CPU climb and never drop (pre-fix). After fix: flat.
