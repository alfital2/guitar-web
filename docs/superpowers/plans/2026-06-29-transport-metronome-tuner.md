# Transport + Metronome + Tuner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar transport cluster (inert ground for recording), a working metronome with tempo control, and a high-precision (McLeod/NSDF) tuner.

**Architecture:** Pure, unit-tested DSP/helpers (`mpm.js`, `cents.js`, metronome helpers) sit under small controllers (`metronome.js`, `tuner.js`) that own audio/mic/timers. Toolbar markup goes in `index.html`; `main.js` wires the controllers to the buttons. Existing engine/effects/START-STOP code is untouched.

**Tech Stack:** Vanilla ES modules, Web Audio API (AudioContext, AnalyserNode, getUserMedia), Vitest + jsdom, no new dependencies.

## Global Constraints

- No new npm dependencies.
- Existing audio/DSP and engine code unchanged: `engine.js`, `effects/*`, `dsp.js`, `pitch/detector.js`, `pitch/note.js`. New modules are added alongside.
- START/STOP keep their meaning (audio engine on/off). Transport buttons are inert/`disabled` now.
- Reference pitch **A440** fixed. Metronome tempo range **40–240**, default **120**.
- Tuner is **standalone** (own mic when engine not live; taps the engine analyser when live).
- All existing tests stay green (`npx vitest run`).
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create `src/pitch/mpm.js`** — pure `detectPitchMPM(buf, sampleRate, opts)` (NSDF + parabolic interpolation).
- **Create `src/pitch/cents.js`** — pure `freqToCents(freq, a4)` → note/octave/cents/refFreq/midi.
- **Create `src/metronome.js`** — `secondsPerBeat`, `clampTempo`, `createMetronome({onBeat})` controller.
- **Create `src/tuner.js`** — `createTuner({getLiveAnalyser, onReading, onState})` controller (mic + rAF loop + median smoothing).
- **Create `src/transport-ui.js`** — builds the toolbar cluster DOM (transport buttons, metronome control, tuner control + strip) and wires it to the controllers.
- **Modify `index.html`** — replace `.title` with `#transport-cluster`; add CSS for transport/metronome/tuner.
- **Modify `src/main.js`** — mount the cluster, pass `getLiveAnalyser`.
- **Create tests:** `tests/mpm.test.js`, `tests/cents.test.js`, `tests/metronome.test.js`.

---

## Task 1: `cents.js` — frequency → note + cents (pure)

**Files:**
- Create: `src/pitch/cents.js`
- Test: `tests/cents.test.js`

**Interfaces:**
- Produces: `freqToCents(freq, a4 = 440) → { name, octave, cents, refFreq, midi }`. `name` ∈ the 12 names with `#`; `octave` is the scientific octave; `cents` ≈ −50…+50; `refFreq` is the in-tune frequency of the nearest note; `midi` is the rounded MIDI number. Returns `null` for `freq <= 0`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cents.test.js`:

```javascript
// tests/cents.test.js
import { describe, it, expect } from 'vitest';
import { freqToCents } from '../src/pitch/cents.js';

describe('freqToCents', () => {
  it('A4 = 440 is exactly in tune', () => {
    const r = freqToCents(440);
    expect(r.name).toBe('A'); expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(0, 5); expect(r.midi).toBe(69);
  });
  it('445 reads A4 about +19.6 cents', () => {
    const r = freqToCents(445);
    expect(r.name).toBe('A'); expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(19.56, 1);
  });
  it('low E string 82.41 Hz is E2 ~0 cents', () => {
    const r = freqToCents(82.41);
    expect(r.name).toBe('E'); expect(r.octave).toBe(2);
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });
  it('466.16 is A#4 ~0 cents', () => {
    const r = freqToCents(466.16);
    expect(r.name).toBe('A#'); expect(r.octave).toBe(4);
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });
  it('refFreq is the nearest in-tune frequency', () => {
    expect(freqToCents(445).refFreq).toBeCloseTo(440, 3);
  });
  it('returns null for non-positive frequency', () => {
    expect(freqToCents(0)).toBeNull();
    expect(freqToCents(-10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cents.test.js`
Expected: FAIL — cannot resolve `../src/pitch/cents.js`.

- [ ] **Step 3: Implement `src/pitch/cents.js`**

```javascript
// src/pitch/cents.js
// Pure frequency → musical note + cents-off mapping (A440 reference).
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToCents(freq, a4 = 440) {
  if (!(freq > 0)) return null;
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiFloat);
  const refFreq = a4 * Math.pow(2, (midi - 69) / 12);
  const cents = 1200 * Math.log2(freq / refFreq);
  const name = NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return { name, octave, cents, refFreq, midi };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cents.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pitch/cents.js tests/cents.test.js
git commit -m "feat: pure freqToCents note/cents mapping (A440)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `mpm.js` — McLeod pitch detector (pure)

**Files:**
- Create: `src/pitch/mpm.js`
- Test: `tests/mpm.test.js`

**Interfaces:**
- Produces: `detectPitchMPM(buf, sampleRate, opts = {}) → { freq, clarity } | null`. `buf` is a `Float32Array` time-domain window. `opts`: `{ threshold = 0.6, minFreq = 50, maxFreq = 1500 }`. Returns `null` when no peak clears the clarity threshold (silence/noise). `freq` is sub-Hz accurate via parabolic interpolation; `clarity` ∈ 0…1.

- [ ] **Step 1: Write the failing tests**

Create `tests/mpm.test.js`:

```javascript
// tests/mpm.test.js
import { describe, it, expect } from 'vitest';
import { detectPitchMPM } from '../src/pitch/mpm.js';

const SR = 44100;
function sine(freq, n = 4096, sr = SR, harmonics = []) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = Math.sin(2 * Math.PI * freq * i / sr);
    for (const [mult, amp] of harmonics) s += amp * Math.sin(2 * Math.PI * freq * mult * i / sr);
    b[i] = s * 0.5;
  }
  return b;
}

describe('detectPitchMPM', () => {
  for (const f of [82.41, 110, 146.83, 220, 440]) {
    it(`detects ${f} Hz within 0.5 Hz`, () => {
      const r = detectPitchMPM(sine(f), SR);
      expect(r).not.toBeNull();
      expect(Math.abs(r.freq - f)).toBeLessThan(0.5);
    });
  }
  it('returns the fundamental even with a strong 2nd harmonic', () => {
    const r = detectPitchMPM(sine(110, 4096, SR, [[2, 0.8]]), SR);
    expect(Math.abs(r.freq - 110)).toBeLessThan(1);
  });
  it('returns null for white noise', () => {
    const b = new Float32Array(4096);
    let seed = 7;
    for (let i = 0; i < b.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b[i] = (seed / 0x7fffffff) * 2 - 1; }
    expect(detectPitchMPM(b, SR)).toBeNull();
  });
  it('returns null for silence', () => {
    expect(detectPitchMPM(new Float32Array(4096), SR)).toBeNull();
  });
  it('reports high clarity for a clean sine', () => {
    expect(detectPitchMPM(sine(220), SR).clarity).toBeGreaterThan(0.9);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/mpm.test.js`
Expected: FAIL — cannot resolve `../src/pitch/mpm.js`.

- [ ] **Step 3: Implement `src/pitch/mpm.js`**

```javascript
// src/pitch/mpm.js
// McLeod Pitch Method: normalized square-difference function (NSDF) with
// parabolic interpolation of the chosen peak. Octave-robust and sub-cent
// accurate for monophonic signals (guitar tuning).

// NSDF over lags 0..maxLag (Tartini/McLeod). Returns Float32Array of length maxLag+1.
function nsdf(buf, maxLag) {
  const n = buf.length;
  const out = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - lag; i++) {
      acf += buf[i] * buf[i + lag];
      m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    out[lag] = m > 0 ? (2 * acf) / m : 0;
  }
  return out;
}

// Indices of the maximum within each region bounded by positive-going zero
// crossings of the NSDF (McLeod's "key maxima").
function keyMaxima(d) {
  const maxima = [];
  let lag = 1;
  // Skip the initial positive lobe down to the first negative zero crossing.
  while (lag < d.length - 1 && d[lag] > 0) lag++;
  while (lag < d.length - 1) {
    if (d[lag] > 0) {
      let best = lag, bestVal = d[lag];
      while (lag < d.length - 1 && d[lag] > 0) {
        if (d[lag] > bestVal) { bestVal = d[lag]; best = lag; }
        lag++;
      }
      maxima.push(best);
    } else {
      lag++;
    }
  }
  return maxima;
}

// Parabolic interpolation around index i of array d → { x, y } (fractional lag, value).
function parabolic(d, i) {
  if (i <= 0 || i >= d.length - 1) return { x: i, y: d[i] };
  const a = d[i - 1], b = d[i], c = d[i + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return { x: i, y: b };
  const delta = 0.5 * (a - c) / denom;
  return { x: i + delta, y: b - 0.25 * (a - c) * delta };
}

export function detectPitchMPM(buf, sampleRate, opts = {}) {
  const { threshold = 0.6, minFreq = 50, maxFreq = 1500 } = opts;
  const maxLag = Math.min(buf.length - 1, Math.floor(sampleRate / minFreq));
  const minLag = Math.max(1, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag) return null;

  const d = nsdf(buf, maxLag);
  const maxima = keyMaxima(d).filter((l) => l >= minLag);
  if (!maxima.length) return null;

  // McLeod: pick the first maximum whose value >= k * the global key maximum.
  let globalMax = 0;
  for (const l of maxima) if (d[l] > globalMax) globalMax = d[l];
  if (globalMax < threshold) return null;
  const k = 0.9;
  const cutoff = k * globalMax;
  let chosen = maxima[0];
  for (const l of maxima) { if (d[l] >= cutoff) { chosen = l; break; } }

  const { x: tau, y: clarity } = parabolic(d, chosen);
  if (tau <= 0) return null;
  const freq = sampleRate / tau;
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity: Math.max(0, Math.min(1, clarity)) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/mpm.test.js`
Expected: PASS (9 tests). If a low-freq case is borderline, the 4096-sample window at 44.1 kHz covers down to ~10 Hz of lag headroom — it should pass; do not loosen tolerances to mask a real bug.

- [ ] **Step 5: Commit**

```bash
git add src/pitch/mpm.js tests/mpm.test.js
git commit -m "feat: McLeod (NSDF) pitch detector with parabolic interpolation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `metronome.js` — tempo helpers + scheduler controller

**Files:**
- Create: `src/metronome.js`
- Test: `tests/metronome.test.js`

**Interfaces:**
- Produces:
  - `secondsPerBeat(bpm) → 60 / bpm`.
  - `clampTempo(bpm) → max(40, min(240, round(bpm)))` (non-finite → 120).
  - `createMetronome({ onBeat } = {}) → { start, stop, toggle, setTempo, getTempo, isRunning }`. `setTempo` clamps; `getTempo` returns the current bpm; `isRunning` reflects scheduler state. `start`/`stop` are safe to call with no Web Audio (in tests they just flip `isRunning` and track tempo — no audio).

- [ ] **Step 1: Write the failing tests**

Create `tests/metronome.test.js`:

```javascript
// tests/metronome.test.js
import { describe, it, expect } from 'vitest';
import { secondsPerBeat, clampTempo, createMetronome } from '../src/metronome.js';

describe('tempo helpers', () => {
  it('secondsPerBeat', () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5);
    expect(secondsPerBeat(60)).toBeCloseTo(1);
  });
  it('clampTempo bounds and rounds', () => {
    expect(clampTempo(20)).toBe(40);
    expect(clampTempo(999)).toBe(240);
    expect(clampTempo(119.6)).toBe(120);
    expect(clampTempo(NaN)).toBe(120);
  });
});

describe('createMetronome (no audio)', () => {
  it('tracks tempo and running state', () => {
    const m = createMetronome();
    expect(m.getTempo()).toBe(120);
    m.setTempo(8000); expect(m.getTempo()).toBe(240);
    expect(m.isRunning()).toBe(false);
    m.start(); expect(m.isRunning()).toBe(true);
    m.toggle(); expect(m.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/metronome.test.js`
Expected: FAIL — cannot resolve `../src/metronome.js`.

- [ ] **Step 3: Implement `src/metronome.js`**

```javascript
// src/metronome.js
// Click metronome using the Web Audio "two clocks" lookahead scheduler. Pure
// tempo helpers are exported for testing; the controller degrades to a no-audio
// state when AudioContext is unavailable (tests / SSR).
export function secondsPerBeat(bpm) { return 60 / bpm; }
export function clampTempo(bpm) {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(40, Math.min(240, Math.round(bpm)));
}

const LOOKAHEAD_MS = 25;     // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.1;  // seconds of audio scheduled in advance
const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

export function createMetronome({ onBeat } = {}) {
  let bpm = 120;
  let running = false;
  let ctx = null;
  let timer = null;
  let nextTime = 0; // audio-clock time of the next click
  let beat = 0;

  function click(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(time); osc.stop(time + 0.06);
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const accent = beat % 4 === 0;
      click(nextTime, accent);
      if (onBeat) {
        const delayMs = Math.max(0, (nextTime - ctx.currentTime) * 1000);
        const b = beat;
        setTimeout(() => onBeat(b), delayMs);
      }
      nextTime += secondsPerBeat(bpm);
      beat++;
    }
  }

  function start() {
    if (running) return;
    running = true;
    if (!AC) return; // no audio (tests) — just track state
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    beat = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(scheduler, LOOKAHEAD_MS);
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function toggle() { running ? stop() : start(); }
  function setTempo(v) { bpm = clampTempo(v); }
  function getTempo() { return bpm; }
  function isRunning() { return running; }

  return { start, stop, toggle, setTempo, getTempo, isRunning };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/metronome.test.js`
Expected: PASS (3 tests). jsdom has no `AudioContext`, so `start()` flips `running` without audio — exactly what the test asserts.

- [ ] **Step 5: Commit**

```bash
git add src/metronome.js tests/metronome.test.js
git commit -m "feat: metronome lookahead scheduler + tempo helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `tuner.js` — mic + detection loop controller

**Files:**
- Create: `src/tuner.js`

**Interfaces:**
- Consumes: `detectPitchMPM` (Task 2), `freqToCents` (Task 1).
- Produces: `createTuner({ getLiveAnalyser, onReading, onState }) → { start, stop, isOn }`.
  - `getLiveAnalyser()` returns an existing `AnalyserNode` (engine running) or a falsy value.
  - `onReading(reading | null)` where `reading = { name, octave, cents, freq, clarity }`.
  - `onState(state)` where `state ∈ { on: boolean, error?: string }`.
  - `start()` is async (acquires mic if needed); `stop()` releases an owned mic and stops the loop.

This task has no unit test (it needs `getUserMedia`/`AudioContext`/`requestAnimationFrame` — browser only). It is verified in Task 7. Keep the median/mapping logic small and obvious.

- [ ] **Step 1: Implement `src/tuner.js`**

```javascript
// src/tuner.js
// Standalone, high-precision tuner. Uses the engine's analyser when live, else
// acquires its own mic. Runs a rAF loop: MPM detect → cents → median smooth.
import { detectPitchMPM } from './pitch/mpm.js';
import { freqToCents } from './pitch/cents.js';

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createTuner({ getLiveAnalyser, onReading, onState }) {
  let on = false;
  let raf = null;
  let ownCtx = null, ownStream = null, ownAnalyser = null;
  let analyser = null;
  let buf = null;
  const hist = []; // recent detected frequencies for smoothing

  async function acquire() {
    const live = getLiveAnalyser && getLiveAnalyser();
    if (live) { analyser = live; return; }
    if (!AC) throw new Error('no-audio');
    ownStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ownCtx = new AC();
    if (ownCtx.state === 'suspended') await ownCtx.resume();
    ownAnalyser = ownCtx.createAnalyser();
    ownAnalyser.fftSize = 4096;
    ownCtx.createMediaStreamSource(ownStream).connect(ownAnalyser);
    analyser = ownAnalyser;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;
    if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const det = detectPitchMPM(buf, analyser.context.sampleRate);
    if (!det) { hist.length = 0; onReading(null); return; }
    hist.push(det.freq);
    if (hist.length > 5) hist.shift();
    const freq = median(hist);
    const c = freqToCents(freq);
    onReading({ name: c.name, octave: c.octave, cents: c.cents, freq, clarity: det.clarity });
  }

  async function start() {
    if (on) return;
    on = true;
    try {
      await acquire();
      onState({ on: true });
      loop();
    } catch (e) {
      on = false;
      onState({ on: false, error: e && e.name === 'NotAllowedError' ? 'Mic permission denied' : 'Mic unavailable' });
    }
  }
  function stop() {
    on = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    hist.length = 0;
    if (ownStream) { ownStream.getTracks().forEach((t) => t.stop()); ownStream = null; }
    if (ownCtx) { ownCtx.close(); ownCtx = null; }
    ownAnalyser = null; analyser = null; buf = null;
    onState({ on: false });
  }
  function isOn() { return on; }
  return { start, stop, isOn };
}
```

- [ ] **Step 2: Verify it imports cleanly (no syntax errors) via the suite**

Run: `npx vitest run`
Expected: PASS — existing tests still green; `tuner.js` is imported by nothing yet, so this just confirms no parse error if another module imports it. (No new test added here.)

- [ ] **Step 3: Commit**

```bash
git add src/tuner.js
git commit -m "feat: standalone high-precision tuner controller (mic + MPM loop)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `transport-ui.js` — toolbar cluster DOM + wiring

**Files:**
- Create: `src/transport-ui.js`
- Test: (none — DOM/audio glue; verified in Task 7)

**Interfaces:**
- Consumes: `createMetronome` (Task 3), `createTuner` (Task 4).
- Produces: `mountTransport(container, { getLiveAnalyser }) → void`. Builds the cluster inside `container` (the element that replaces `.title`): inert transport buttons, metronome control, tuner control + strip; instantiates and wires the metronome + tuner.

- [ ] **Step 1: Implement `src/transport-ui.js`**

```javascript
// src/transport-ui.js
import { createMetronome, clampTempo } from './metronome.js';
import { createTuner } from './tuner.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Inert transport buttons — ground for the coming recording feature.
const TP = [
  ['tp-rewind', '⏪', 'Rewind'],
  ['tp-ffwd', '⏩', 'Fast-forward'],
  ['tp-start', '⏮', 'Skip to start'],
  ['tp-play', '▶', 'Play'],
  ['tp-record', '⏺', 'Record'],
];

export function mountTransport(container, { getLiveAnalyser }) {
  container.innerHTML = '';
  container.classList.add('transport-cluster');

  // ── Transport (inert) ──
  const transport = el('div', 'transport');
  for (const [id, glyph, label] of TP) {
    const b = el('button', 'tp-btn' + (id === 'tp-record' ? ' tp-record' : ''));
    b.id = id; b.type = 'button'; b.disabled = true;
    b.title = `${label} — available with recording`;
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    transport.appendChild(b);
  }

  // ── Metronome ──
  const metro = el('div', 'metro');
  const metroBtn = el('button', 'metro-toggle'); metroBtn.id = 'metro-toggle'; metroBtn.type = 'button';
  metroBtn.title = 'Metronome'; metroBtn.setAttribute('aria-label', 'Metronome'); metroBtn.textContent = '♩';
  const bpm = el('span', 'metro-bpm'); bpm.id = 'metro-bpm';
  const bpmVal = el('span', 'metro-bpm-val'); bpmVal.textContent = '120';
  const bpmLbl = el('span', 'metro-bpm-lbl'); bpmLbl.textContent = 'BPM';
  bpm.append(bpmVal, bpmLbl);
  bpm.title = 'Drag or scroll to change · click to type';
  metro.append(metroBtn, bpm);

  const metronome = createMetronome({
    onBeat: (b) => { metroBtn.classList.add(b % 4 === 0 ? 'beat-accent' : 'beat'); setTimeout(() => metroBtn.classList.remove('beat', 'beat-accent'), 90); },
  });
  metroBtn.addEventListener('click', () => { metronome.toggle(); metroBtn.classList.toggle('on', metronome.isRunning()); });

  // BPM scrub (drag vertical / wheel) + click-to-type.
  const setBpm = (v) => { const n = clampTempo(v); metronome.setTempo(n); bpmVal.textContent = String(n); };
  let dragY = 0, dragV = 0, dragging = false;
  bpm.addEventListener('pointerdown', (e) => { dragging = true; dragY = e.clientY; dragV = metronome.getTempo(); bpm.setPointerCapture(e.pointerId); e.preventDefault(); });
  bpm.addEventListener('pointermove', (e) => { if (!dragging) return; setBpm(dragV + Math.round((dragY - e.clientY) / 4)); });
  bpm.addEventListener('pointerup', () => { dragging = false; });
  bpm.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(metronome.getTempo() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  bpm.addEventListener('click', (e) => {
    if (dragging) return;
    const input = el('input', 'metro-bpm-input'); input.type = 'text'; input.inputMode = 'numeric'; input.value = String(metronome.getTempo());
    bpm.replaceWith(input); input.focus(); input.select();
    const commit = (apply) => { if (apply) setBpm(parseInt(input.value, 10)); input.replaceWith(bpm); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
  });

  // ── Tuner ──
  const tunerWrap = el('div', 'tuner');
  const tunerBtn = el('button', 'tuner-toggle'); tunerBtn.id = 'tuner-toggle'; tunerBtn.type = 'button';
  tunerBtn.title = 'Tuner'; tunerBtn.setAttribute('aria-label', 'Tuner'); tunerBtn.textContent = 'TUNER';
  const strip = el('div', 'tuner-strip'); strip.hidden = true;
  strip.innerHTML = `
    <span class="tuner-note">—</span>
    <span class="tuner-meter"><span class="tuner-ticks"></span><span class="tuner-needle"></span></span>
    <span class="tuner-readout"><span class="tuner-cents">--</span><span class="tuner-hz">— Hz</span></span>`;
  tunerWrap.append(tunerBtn, strip);
  const noteEl = strip.querySelector('.tuner-note');
  const needle = strip.querySelector('.tuner-needle');
  const centsEl = strip.querySelector('.tuner-cents');
  const hzEl = strip.querySelector('.tuner-hz');

  const tuner = createTuner({
    getLiveAnalyser,
    onReading: (r) => {
      if (!r) { noteEl.textContent = '—'; needle.style.left = '50%'; strip.classList.remove('in-tune'); centsEl.textContent = '--'; hzEl.textContent = '— Hz'; return; }
      noteEl.textContent = `${r.name}${r.octave}`;
      const pct = Math.max(0, Math.min(100, 50 + r.cents)); // −50..+50 → 0..100%
      needle.style.left = `${pct}%`;
      strip.classList.toggle('in-tune', Math.abs(r.cents) < 3);
      centsEl.textContent = `${r.cents >= 0 ? '+' : ''}${r.cents.toFixed(1)}¢`;
      hzEl.textContent = `${r.freq.toFixed(1)} Hz`;
    },
    onState: (s) => {
      tunerBtn.classList.toggle('on', s.on);
      strip.hidden = !s.on;
      if (s.error) { noteEl.textContent = s.error; }
    },
  });
  tunerBtn.addEventListener('click', () => { tuner.isOn() ? tuner.stop() : tuner.start(); });

  container.append(transport, metro, tunerWrap);
}
```

- [ ] **Step 2: Verify suite still parses/green**

Run: `npx vitest run`
Expected: PASS — no module imports `transport-ui.js` yet (added in Task 6), so existing tests are unaffected.

- [ ] **Step 3: Commit**

```bash
git add src/transport-ui.js
git commit -m "feat: toolbar transport cluster (inert transport, metronome, tuner)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Mount in `index.html` + `main.js`, add styles

**Files:**
- Modify: `index.html` (toolbar markup + CSS)
- Modify: `src/main.js` (mount the cluster)

**Interfaces:**
- Consumes: `mountTransport` (Task 5), the module-scope `analyser` in `main.js` (engine's `AnalyserNode`, or `null` when stopped).

- [ ] **Step 1: Replace the title in `index.html`**

Find:
```html
    <div class="title">Guitar Studio</div>
```
Replace with:
```html
    <div id="transport-cluster"></div>
```

- [ ] **Step 2: Add styles to `index.html`**

In the `<style>` block, after the `.toolbar-actions { … }` rule, add:

```css
  /* ── Transport cluster (center of toolbar) ──────────── */
  .transport-cluster {
    position: absolute; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px;
  }
  .transport { display: flex; align-items: center; gap: 4px; }
  .tp-btn {
    width: 30px; height: 28px; padding: 0; display: flex; align-items: center; justify-content: center;
    font-size: 13px; color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px;
  }
  .tp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .tp-record { color: var(--red); }
  .tp-record:disabled { opacity: 0.7; }

  .metro { display: flex; align-items: center; gap: 8px; padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.08); }
  .metro-toggle { width: 30px; height: 28px; padding: 0; font-size: 14px; border-radius: 6px; }
  .metro-toggle.on { color: var(--accent); border-color: rgba(var(--accent-rgb),0.5); background: rgba(var(--accent-rgb),0.12); }
  .metro-toggle.beat { box-shadow: 0 0 0 2px rgba(var(--accent-rgb),0.4); }
  .metro-toggle.beat-accent { box-shadow: 0 0 0 2px var(--accent); }
  .metro-bpm { display: inline-flex; align-items: baseline; gap: 4px; cursor: ns-resize; user-select: none; touch-action: none; padding: 4px 6px; border-radius: 6px; }
  .metro-bpm:hover { background: rgba(255,255,255,0.05); }
  .metro-bpm-val { font: 600 13px var(--mono); color: var(--text); min-width: 26px; text-align: right; }
  .metro-bpm-lbl { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: var(--muted); }
  .metro-bpm-input { width: 44px; font: 600 13px var(--mono); color: var(--text); background: var(--surface); border: 1px solid var(--border-hi); border-radius: 6px; padding: 3px 5px; }

  .tuner { display: flex; align-items: center; gap: 10px; padding-left: 12px; border-left: 1px solid rgba(255,255,255,0.08); }
  .tuner-toggle { height: 28px; padding: 0 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; border-radius: 6px; }
  .tuner-toggle.on { color: var(--accent); border-color: rgba(var(--accent-rgb),0.5); background: rgba(var(--accent-rgb),0.12); }
  .tuner-strip { display: flex; align-items: center; gap: 10px; }
  .tuner-note { font: 800 16px var(--mono); color: var(--green); min-width: 34px; text-align: center; }
  .tuner-meter { position: relative; width: 140px; height: 16px; background: rgba(255,255,255,0.04); border-radius: 8px; overflow: hidden; }
  .tuner-ticks { position: absolute; inset: 0; background:
      linear-gradient(90deg, transparent 49.5%, rgba(255,255,255,0.35) 49.5% 50.5%, transparent 50.5%); }
  .tuner-needle { position: absolute; top: 1px; bottom: 1px; left: 50%; width: 2px; margin-left: -1px; background: var(--accent); border-radius: 1px; transition: left .06s linear; }
  .tuner-strip.in-tune .tuner-needle { background: var(--green); box-shadow: 0 0 6px var(--green); }
  .tuner-readout { display: flex; flex-direction: column; line-height: 1.1; }
  .tuner-cents { font: 600 11px var(--mono); color: var(--text-secondary); }
  .tuner-hz { font: 9px var(--mono); color: var(--muted); }
  @media (max-width: 760px) { .tuner-strip { display: none; } }
  @media (max-width: 980px) { .transport-cluster { position: static; transform: none; } }
```

- [ ] **Step 3: Mount from `src/main.js`**

Add an import near the other imports at the top of `src/main.js`:

```javascript
import { mountTransport } from './transport-ui.js';
```

Near the bottom of `src/main.js` (after the `initChain()` IIFE), add:

```javascript
// Toolbar transport cluster: inert transport (ground for recording) + working
// metronome and tuner. The tuner taps the live engine analyser when running.
mountTransport($('transport-cluster'), { getLiveAnalyser: () => analyser });
```

- [ ] **Step 4: Run the suite**

Run: `npx vitest run`
Expected: PASS — all existing suites plus the new `cents`/`mpm`/`metronome` tests. `main.js`/`transport-ui.js` aren't unit-tested (DOM/audio), so this confirms nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.js
git commit -m "feat: mount transport cluster in toolbar (replaces title) + styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Browser verification

**Files:** none (manual/headless verification).

- [ ] **Step 1: Serve and screenshot the toolbar**

```bash
cd /Users/tal/Documents/guitar_web
python3 -m http.server 8180 >/tmp/gs.log 2>&1 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --window-size=1680,260 --virtual-time-budget=2500 --screenshot=/tmp/tp.png "http://localhost:8180/index.html"
```

Read `/tmp/tp.png`. Expected: centered transport row (rewind/ffwd/skip/play/record, record red) + metronome (♩ + "120 BPM") + "TUNER" button; START/STOP/settings still on the right; no layout overflow.

- [ ] **Step 2: Drive metronome + tuner via DevTools (CDP)**

Launch Chrome with `--remote-debugging-port` and `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` (fake mic so the tuner can start headless). Via the DevTools protocol (Node global `WebSocket`, the pattern used previously):
- Click `#metro-toggle` → assert `.metro-toggle.on` present and (best-effort) that no error is thrown.
- Scrub: dispatch wheel on `#metro-bpm` → assert `.metro-bpm-val` increments.
- Click `#tuner-toggle` → assert `#tuner-strip` becomes visible (`hidden=false`) and `.tuner-toggle.on`; after ~500ms assert `.tuner-note`/`.tuner-hz` update (fake device emits a tone) or remain `—` gracefully.
- Click `#tuner-toggle` again → assert strip hidden and (if standalone) mic released.

Expected: metronome toggles + tempo changes; tuner strip shows/hides; transport buttons report `disabled === true`.

- [ ] **Step 3: Verify no horizontal scroll at desktop + laptop widths**

Via CDP at widths 1680 and 1280: assert `document.documentElement.scrollWidth === clientWidth`.

- [ ] **Step 4: Clean up and final suite**

```bash
pkill -f "http.server 8180"; rm -f /tmp/tp.png
cd /Users/tal/Documents/guitar_web && npx vitest run
```
Expected: PASS. If verification surfaced a bug, fix with a TDD cycle and commit.

---

## Self-Review Notes

- **Spec coverage:** transport ground (T5/T6), metronome audio+UI (T3/T5/T6), tuner detector (T2), cents mapping (T1), tuner controller+mic (T4), tuner UI/strip (T5/T6), layout/styles (T6), tests (T1–T3), browser verification (T7). All spec sections covered.
- **Type consistency:** `createMetronome({onBeat})` → `{start,stop,toggle,setTempo,getTempo,isRunning}` used identically in T3/T5. `createTuner({getLiveAnalyser,onReading,onState})` → `{start,stop,isOn}` in T4/T5. `detectPitchMPM(buf,sr,opts)→{freq,clarity}|null` in T2/T4. `freqToCents(freq,a4)→{name,octave,cents,refFreq,midi}` in T1/T4. `mountTransport(container,{getLiveAnalyser})` in T5/T6.
- **No placeholders:** every code step is complete.
- **Note:** the existing hero note-circle (engine note display) is intentionally left as-is; the tuner is a separate, more precise readout per the spec.
