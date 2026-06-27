# Guitar Tone Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a per-guitar tonal fingerprint and apply a gentle, strength-scaled corrective EQ before the artist chain, so presets sound consistent across guitars.

**Architecture:** A calibration stage (`source → calibrationEq → engine.input`) holds the active guitar's band corrections. Pure-logic modules (band mapping, spectral analyzer, correction math) are unit-tested with synthetic data; the EQ node is tested with the existing `FakeAudioContext`; profiles persist in `localStorage` (tested via jsdom's localStorage). The capture wizard and main wiring are browser glue, verified by ear.

**Tech Stack:** Vanilla JS (ES modules), Web Audio API (`AnalyserNode`, `BiquadFilterNode`), Vitest + jsdom.

## Global Constraints

- **Target browser:** Chrome/Chromium. No bundler; native ES modules.
- **Calibration is a fixed first stage**, before the artist chain; independent of preset switching.
- **Band model:** 10 log-spaced bands. `BANDS = [80,133,223,371,619,1033,1724,2874,4794,8000]` (Hz). The same constant is shared by analyzer, correction, and EQ.
- **Neutral reference = flat** (target band balance all-zero after normalization).
- **Correction:** `target − fingerprint`, 3-point smoothed, hard-capped at **±6 dB**, then scaled by **strength** (0..1, default **0.65**). strength 0 → transparent.
- **Fingerprint** is normalized band dB (mean subtracted) — a tonal *shape*, not loudness.
- **Storage key:** `guitar-calibration-profiles`; shape `{ profiles: [{name, fingerprint, strength}], activeName }`. Storage access never throws.
- **Reuse** the `{input, output, apply}` node convention and `tests/fake-audio-context.js`.

---

## File Structure

- `src/calibration/bands.js` — `BANDS` constant + band-mapping helpers (`bandEdges`, `bandIndexFor`, `bandPowersFromMagnitudes`).
- `src/calibration/analyzer.js` — accumulator + `fingerprint` + `coverage` (pure).
- `src/calibration/correction.js` — `computeCorrection(fingerprint, strength)` (pure).
- `src/calibration/calibration-eq.js` — `createCalibrationEq(ctx)` → `{input, output, apply, filters}`.
- `src/calibration/profiles.js` — localStorage CRUD.
- `src/calibration/ui.js` — `renderCalibrationControls(...)` (picker + strength + Calibrate button).
- `src/main.js` (modify) — insert calibration EQ, load active profile, run capture wizard.
- `index.html` (modify) — calibration panel markup.
- `tests/calibration-*.test.js` — unit tests.

---

### Task 1: Band model + band mapping

**Files:**
- Create: `src/calibration/bands.js`
- Test: `tests/calibration-bands.test.js`

**Interfaces:**
- Produces:
  - `BANDS` — array of 10 center freqs (above).
  - `bandEdges(bands=BANDS) → number[]` length N+1 — geometric edges between centers (and extrapolated outer edges).
  - `bandIndexFor(freqHz, edges) → number` — index `b` with `edges[b] ≤ f < edges[b+1]`, else `-1`.
  - `bandPowersFromMagnitudes(mags, sampleRate, bands=BANDS) → Float64Array` length N — average power (magnitude²) of FFT bins falling in each band. `mags[i]` is the linear magnitude of bin `i`; bin frequency = `i * sampleRate / (2*mags.length)`.

- [ ] **Step 1: Write failing tests**

```js
// tests/calibration-bands.test.js
import { describe, it, expect } from 'vitest';
import { BANDS, bandEdges, bandIndexFor, bandPowersFromMagnitudes } from '../src/calibration/bands.js';

describe('BANDS', () => {
  it('has 10 ascending centers from 80 to 8000', () => {
    expect(BANDS).toHaveLength(10);
    expect(BANDS[0]).toBe(80);
    expect(BANDS[9]).toBe(8000);
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i]).toBeGreaterThan(BANDS[i - 1]);
  });
});

describe('bandEdges / bandIndexFor', () => {
  const edges = bandEdges(BANDS);
  it('produces N+1 ascending edges', () => {
    expect(edges).toHaveLength(11);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });
  it('maps a center frequency into its own band', () => {
    expect(bandIndexFor(80, edges)).toBe(0);
    expect(bandIndexFor(1033, edges)).toBe(5);
    expect(bandIndexFor(8000, edges)).toBe(9);
  });
  it('returns -1 below/above the range', () => {
    expect(bandIndexFor(1, edges)).toBe(-1);
    expect(bandIndexFor(50000, edges)).toBe(-1);
  });
});

describe('bandPowersFromMagnitudes', () => {
  it('puts a tone in the correct band', () => {
    // fftSize = 2*mags.length. Choose 512 bins, sampleRate 48000 -> binHz = 48000/1024 = 46.875
    const mags = new Float32Array(512);
    const targetBin = Math.round(1033 / (48000 / 1024)); // ~22
    mags[targetBin] = 10;
    const powers = bandPowersFromMagnitudes(mags, 48000);
    const maxBand = powers.indexOf(Math.max(...powers));
    expect(maxBand).toBe(5); // 1033 Hz band
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/calibration-bands.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/calibration/bands.js`**

```js
// src/calibration/bands.js
export const BANDS = [80, 133, 223, 371, 619, 1033, 1724, 2874, 4794, 8000];

export function bandEdges(bands = BANDS) {
  const N = bands.length;
  const edges = new Array(N + 1);
  const firstRatio = bands[1] / bands[0];
  const lastRatio = bands[N - 1] / bands[N - 2];
  edges[0] = bands[0] / Math.sqrt(firstRatio);
  for (let i = 1; i < N; i++) edges[i] = Math.sqrt(bands[i - 1] * bands[i]);
  edges[N] = bands[N - 1] * Math.sqrt(lastRatio);
  return edges;
}

export function bandIndexFor(freqHz, edges) {
  if (freqHz < edges[0] || freqHz >= edges[edges.length - 1]) return -1;
  for (let b = 0; b < edges.length - 1; b++) {
    if (freqHz >= edges[b] && freqHz < edges[b + 1]) return b;
  }
  return -1;
}

export function bandPowersFromMagnitudes(mags, sampleRate, bands = BANDS) {
  const N = bands.length;
  const edges = bandEdges(bands);
  const binHz = sampleRate / (2 * mags.length);
  const sums = new Float64Array(N);
  const counts = new Float64Array(N);
  for (let i = 0; i < mags.length; i++) {
    const f = i * binHz;
    const b = bandIndexFor(f, edges);
    if (b >= 0) { const m = mags[i]; sums[b] += m * m; counts[b]++; }
  }
  const out = new Float64Array(N);
  for (let b = 0; b < N; b++) out[b] = counts[b] ? sums[b] / counts[b] : 0;
  return out;
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-bands.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/bands.js tests/calibration-bands.test.js
git commit -m "feat: calibration band model + spectral band mapping"
```

---

### Task 2: Spectral analyzer (accumulator, fingerprint, coverage)

**Files:**
- Create: `src/calibration/analyzer.js`
- Test: `tests/calibration-analyzer.test.js`

**Interfaces:**
- Consumes: `BANDS` from `bands.js`.
- Produces:
  - `createAccumulator(numBands=BANDS.length) → state` with `{ sums:Float64Array, frames:number, bandSeen:boolean[], maxLevel:number }`.
  - `accumulate(state, bandPowers, level, seenThreshold=1e-6) → state` — adds the frame's per-band powers, marks bands whose power exceeds `seenThreshold`, increments `frames`, tracks `maxLevel`.
  - `fingerprint(state) → number[]` length N — `10*log10(avgPower)` per band, then mean-subtracted (normalized shape).
  - `coverage(state, minFrames, levelGate=0.02) → { bandFraction, durationFraction, leveled, coverage }` — `coverage = leveled ? min(bandFraction, durationFraction) : 0`.

- [ ] **Step 1: Write failing tests**

```js
// tests/calibration-analyzer.test.js
import { describe, it, expect } from 'vitest';
import { createAccumulator, accumulate, fingerprint, coverage } from '../src/calibration/analyzer.js';

describe('accumulator + fingerprint', () => {
  it('accumulates frames and produces a normalized (mean ~0) fingerprint', () => {
    let s = createAccumulator(4);
    // band 2 consistently hotter
    s = accumulate(s, [1, 1, 100, 1], 0.5);
    s = accumulate(s, [1, 1, 100, 1], 0.5);
    const fp = fingerprint(s);
    expect(fp).toHaveLength(4);
    const mean = fp.reduce((a, c) => a + c, 0) / fp.length;
    expect(mean).toBeCloseTo(0, 6);          // normalized
    expect(fp[2]).toBeGreaterThan(fp[0]);    // hot band is highest
  });
});

describe('coverage', () => {
  it('is 0 when level gate not met', () => {
    let s = createAccumulator(4);
    s = accumulate(s, [1, 1, 1, 1], 0.0); // silent
    expect(coverage(s, 1).coverage).toBe(0);
  });
  it('rises as bands fill and duration is met', () => {
    let s = createAccumulator(4);
    for (let i = 0; i < 10; i++) s = accumulate(s, [1, 1, 1, 1], 0.5);
    const c = coverage(s, 10);
    expect(c.bandFraction).toBe(1);
    expect(c.durationFraction).toBe(1);
    expect(c.leveled).toBe(true);
    expect(c.coverage).toBe(1);
  });
  it('partial band coverage caps the score', () => {
    let s = createAccumulator(4);
    for (let i = 0; i < 10; i++) s = accumulate(s, [1, 0, 0, 0], 0.5); // only band 0 seen
    const c = coverage(s, 10);
    expect(c.bandFraction).toBeCloseTo(0.25);
    expect(c.coverage).toBeCloseTo(0.25);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test tests/calibration-analyzer.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement `src/calibration/analyzer.js`**

```js
// src/calibration/analyzer.js
import { BANDS } from './bands.js';

export function createAccumulator(numBands = BANDS.length) {
  return {
    sums: new Float64Array(numBands),
    frames: 0,
    bandSeen: new Array(numBands).fill(false),
    maxLevel: 0,
  };
}

export function accumulate(state, bandPowers, level, seenThreshold = 1e-6) {
  for (let b = 0; b < bandPowers.length; b++) {
    state.sums[b] += bandPowers[b];
    if (bandPowers[b] > seenThreshold) state.bandSeen[b] = true;
  }
  state.frames++;
  if (level > state.maxLevel) state.maxLevel = level;
  return state;
}

export function fingerprint(state) {
  const N = state.sums.length;
  const denom = Math.max(1, state.frames);
  const db = new Float64Array(N);
  for (let b = 0; b < N; b++) db[b] = 10 * Math.log10(state.sums[b] / denom + 1e-9);
  const mean = db.reduce((a, c) => a + c, 0) / N;
  return Array.from(db, (v) => v - mean);
}

export function coverage(state, minFrames, levelGate = 0.02) {
  const bandFraction = state.bandSeen.filter(Boolean).length / state.bandSeen.length;
  const durationFraction = Math.min(1, state.frames / minFrames);
  const leveled = state.maxLevel >= levelGate;
  return { bandFraction, durationFraction, leveled, coverage: leveled ? Math.min(bandFraction, durationFraction) : 0 };
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-analyzer.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/analyzer.js tests/calibration-analyzer.test.js
git commit -m "feat: spectral analyzer (fingerprint + coverage)"
```

---

### Task 3: Correction math

**Files:**
- Create: `src/calibration/correction.js`
- Test: `tests/calibration-correction.test.js`

**Interfaces:**
- Produces: `computeCorrection(fingerprint, strength, opts={}) → number[]` length N. `opts.cap` defaults 6. Steps: `raw = -fingerprint`; 3-point moving-average smooth (edge-clamped); cap each to `[-cap, cap]`; multiply by `strength`.

- [ ] **Step 1: Write failing tests**

```js
// tests/calibration-correction.test.js
import { describe, it, expect } from 'vitest';
import { computeCorrection } from '../src/calibration/correction.js';

describe('computeCorrection', () => {
  it('flat fingerprint -> ~zero correction', () => {
    const c = computeCorrection([0, 0, 0, 0, 0], 1);
    c.forEach(v => expect(Math.abs(v)).toBeLessThan(1e-9));
  });
  it('strength 0 -> all zeros', () => {
    const c = computeCorrection([10, -10, 5, -5, 0], 0);
    c.forEach(v => expect(v).toBe(0));
  });
  it('opposes the fingerprint (boosts a dip, cuts a peak)', () => {
    // band 0 is loud (+10), band 4 is quiet (-10)
    const c = computeCorrection([10, 8, 0, -8, -10], 1);
    expect(c[0]).toBeLessThan(0);  // cut the loud band
    expect(c[4]).toBeGreaterThan(0); // boost the quiet band
  });
  it('caps at +/-6 dB before strength scaling', () => {
    const c = computeCorrection([100, 100, 100, 100, 100], 1); // raw -100 each, smoothed -100, capped -6
    c.forEach(v => expect(v).toBeCloseTo(-6));
    const half = computeCorrection([100, 100, 100, 100, 100], 0.5);
    half.forEach(v => expect(v).toBeCloseTo(-3)); // cap then *strength
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test tests/calibration-correction.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement `src/calibration/correction.js`**

```js
// src/calibration/correction.js
export function computeCorrection(fingerprint, strength, opts = {}) {
  const cap = opts.cap ?? 6;
  const N = fingerprint.length;
  const raw = fingerprint.map((v) => -v);
  const smoothed = raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(N - 1, i + 1)];
    return (a + b + c) / 3;
  });
  return smoothed.map((v) => Math.max(-cap, Math.min(cap, v)) * strength);
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-correction.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/correction.js tests/calibration-correction.test.js
git commit -m "feat: calibration correction math (smooth + cap + strength)"
```

---

### Task 4: Calibration EQ node

**Files:**
- Create: `src/calibration/calibration-eq.js`
- Test: `tests/calibration-eq.test.js`

**Interfaces:**
- Consumes: `BANDS`, `FakeAudioContext`.
- Produces: `createCalibrationEq(ctx, bands=BANDS) → { input, output, apply, filters }`. `input`/`output` are gain nodes; `filters` is an array of N peaking `BiquadFilter`s centered on `bands`, chained `input → f0 → … → fN-1 → output`. `apply(correctionDb)` sets each filter's `gain.value` (missing entries → 0).

- [ ] **Step 1: Write failing test**

```js
// tests/calibration-eq.test.js
import { describe, it, expect } from 'vitest';
import { createCalibrationEq } from '../src/calibration/calibration-eq.js';
import { BANDS } from '../src/calibration/bands.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('createCalibrationEq', () => {
  it('builds N peaking filters at the band centers, chained input->...->output', () => {
    const ctx = new FakeAudioContext();
    const eq = createCalibrationEq(ctx);
    expect(eq.filters).toHaveLength(BANDS.length);
    eq.filters.forEach((f, i) => { expect(f.type).toBe('peaking'); expect(f.frequency.value).toBe(BANDS[i]); });
    expect(eq.input.kind).toBe('gain');
    expect(eq.output.kind).toBe('gain');
    // input connects to first filter; last filter connects to output
    expect(ctx.connections.some(c => c.from === eq.input.id && c.to === eq.filters[0].id)).toBe(true);
    expect(ctx.connections.some(c => c.from === eq.filters[BANDS.length - 1].id && c.to === eq.output.id)).toBe(true);
  });
  it('apply sets filter gains; zeros are transparent', () => {
    const ctx = new FakeAudioContext();
    const eq = createCalibrationEq(ctx);
    eq.apply([1, 2, 3]);
    expect(eq.filters[0].gain.value).toBe(1);
    expect(eq.filters[2].gain.value).toBe(3);
    expect(eq.filters[3].gain.value).toBe(0); // missing -> 0
    eq.apply(new Array(BANDS.length).fill(0));
    eq.filters.forEach(f => expect(f.gain.value).toBe(0));
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test tests/calibration-eq.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement `src/calibration/calibration-eq.js`**

```js
// src/calibration/calibration-eq.js
import { BANDS } from './bands.js';

export function createCalibrationEq(ctx, bands = BANDS) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const filters = bands.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking';
    b.frequency.value = f;
    b.Q.value = 1;
    b.gain.value = 0;
    return b;
  });
  let prev = input;
  for (const f of filters) { prev.connect(f); prev = f; }
  prev.connect(output);

  function apply(correctionDb) {
    for (let i = 0; i < filters.length; i++) filters[i].gain.value = correctionDb[i] ?? 0;
  }
  return { input, output, apply, filters };
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-eq.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/calibration-eq.js tests/calibration-eq.test.js
git commit -m "feat: calibration EQ node (N peaking bands)"
```

---

### Task 5: Profile storage (localStorage)

**Files:**
- Create: `src/calibration/profiles.js`
- Test: `tests/calibration-profiles.test.js`

**Interfaces:**
- Produces (all operate on `localStorage` key `guitar-calibration-profiles`, shape `{profiles:[{name,fingerprint,strength}], activeName}`; reads never throw):
  - `listProfiles() → array`
  - `saveProfile(name, fingerprint, strength) → profile` (upsert by name, sets it active)
  - `getActive() → profile | null`
  - `setActive(name) → void`
  - `setStrength(name, s) → void`
  - `deleteProfile(name) → void` (clears active if it was active)

- [ ] **Step 1: Write failing tests** (jsdom provides `localStorage`)

```js
// tests/calibration-profiles.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { listProfiles, saveProfile, getActive, setActive, setStrength, deleteProfile } from '../src/calibration/profiles.js';

beforeEach(() => localStorage.clear());

describe('profiles', () => {
  it('saves and lists; save sets active', () => {
    saveProfile('Strat', [0, 1, 2], 0.65);
    expect(listProfiles().map(p => p.name)).toEqual(['Strat']);
    expect(getActive().name).toBe('Strat');
    expect(getActive().fingerprint).toEqual([0, 1, 2]);
  });
  it('upserts by name', () => {
    saveProfile('Strat', [1], 0.5);
    saveProfile('Strat', [2], 0.7);
    expect(listProfiles()).toHaveLength(1);
    expect(getActive().fingerprint).toEqual([2]);
    expect(getActive().strength).toBe(0.7);
  });
  it('setActive / setStrength', () => {
    saveProfile('A', [1], 0.5); saveProfile('B', [2], 0.5);
    setActive('A'); expect(getActive().name).toBe('A');
    setStrength('A', 0.9); expect(getActive().strength).toBe(0.9);
  });
  it('delete removes and clears active', () => {
    saveProfile('A', [1], 0.5);
    deleteProfile('A');
    expect(listProfiles()).toEqual([]);
    expect(getActive()).toBeNull();
  });
  it('corrupt storage -> empty, no throw', () => {
    localStorage.setItem('guitar-calibration-profiles', 'not json');
    expect(listProfiles()).toEqual([]);
    expect(getActive()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test tests/calibration-profiles.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement `src/calibration/profiles.js`**

```js
// src/calibration/profiles.js
const KEY = 'guitar-calibration-profiles';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { profiles: [], activeName: null };
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.profiles)) return { profiles: [], activeName: null };
    return { profiles: d.profiles, activeName: d.activeName ?? null };
  } catch {
    return { profiles: [], activeName: null };
  }
}
function write(d) { localStorage.setItem(KEY, JSON.stringify(d)); }

export function listProfiles() { return read().profiles; }

export function saveProfile(name, fingerprint, strength) {
  const d = read();
  const prof = { name, fingerprint, strength };
  const i = d.profiles.findIndex((p) => p.name === name);
  if (i >= 0) d.profiles[i] = prof; else d.profiles.push(prof);
  d.activeName = name;
  write(d);
  return prof;
}

export function getActive() {
  const d = read();
  return d.profiles.find((p) => p.name === d.activeName) || null;
}

export function setActive(name) { const d = read(); d.activeName = name; write(d); }

export function setStrength(name, s) {
  const d = read();
  const p = d.profiles.find((x) => x.name === name);
  if (p) { p.strength = s; write(d); }
}

export function deleteProfile(name) {
  const d = read();
  d.profiles = d.profiles.filter((p) => p.name !== name);
  if (d.activeName === name) d.activeName = null;
  write(d);
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-profiles.test.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/profiles.js tests/calibration-profiles.test.js
git commit -m "feat: guitar calibration profile storage"
```

---

### Task 6: Calibration controls UI

**Files:**
- Create: `src/calibration/ui.js`
- Test: `tests/calibration-ui.test.js`

**Interfaces:**
- Produces: `renderCalibrationControls(container, { profiles, activeName, strength }, handlers) → void`. Builds: a `<select>` (first option "None" with value `""`, then one per profile name; selected = activeName), a strength `<input type=range min=0 max=1 step=0.01>` (value = strength), and a "Calibrate New Guitar" `<button>`. Wires: select change → `handlers.onSelect(name)` (`""` → `null`); range input → `handlers.onStrength(Number(value))`; button click → `handlers.onCalibrate()`. Clears container first.

- [ ] **Step 1: Write failing test** (jsdom env)

```js
// tests/calibration-ui.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderCalibrationControls } from '../src/calibration/ui.js';

function setup(over = {}) {
  const el = document.createElement('div');
  const handlers = { onSelect: vi.fn(), onStrength: vi.fn(), onCalibrate: vi.fn() };
  renderCalibrationControls(el, { profiles: [{ name: 'Strat' }, { name: 'LP' }], activeName: 'LP', strength: 0.65, ...over }, handlers);
  return { el, handlers };
}

describe('renderCalibrationControls', () => {
  it('lists None + profiles and preselects active', () => {
    const { el } = setup();
    const opts = [...el.querySelectorAll('option')].map(o => o.textContent);
    expect(opts).toEqual(['None', 'Strat', 'LP']);
    expect(el.querySelector('select').value).toBe('LP');
  });
  it('select change fires onSelect (None -> null)', () => {
    const { el, handlers } = setup();
    const sel = el.querySelector('select');
    sel.value = ''; sel.dispatchEvent(new Event('change'));
    expect(handlers.onSelect).toHaveBeenCalledWith(null);
    sel.value = 'Strat'; sel.dispatchEvent(new Event('change'));
    expect(handlers.onSelect).toHaveBeenCalledWith('Strat');
  });
  it('strength slider fires onStrength with a number', () => {
    const { el, handlers } = setup();
    const r = el.querySelector('input[type=range]');
    r.value = '0.4'; r.dispatchEvent(new Event('input'));
    expect(handlers.onStrength).toHaveBeenCalledWith(0.4);
  });
  it('calibrate button fires onCalibrate', () => {
    const { el, handlers } = setup();
    el.querySelector('button').dispatchEvent(new Event('click'));
    expect(handlers.onCalibrate).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `npm test tests/calibration-ui.test.js` — Expected: FAIL.

- [ ] **Step 3: Implement `src/calibration/ui.js`**

```js
// src/calibration/ui.js
export function renderCalibrationControls(container, state, handlers) {
  container.innerHTML = '';
  const { profiles = [], activeName = null, strength = 0.65 } = state;

  const select = document.createElement('select');
  const none = new Option('None', '');
  select.add(none);
  for (const p of profiles) select.add(new Option(p.name, p.name));
  select.value = activeName ?? '';
  select.addEventListener('change', () => handlers.onSelect(select.value === '' ? null : select.value));

  const range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.01'; range.value = String(strength);
  range.addEventListener('input', () => handlers.onStrength(Number(range.value)));

  const btn = document.createElement('button');
  btn.textContent = 'Calibrate New Guitar';
  btn.addEventListener('click', () => handlers.onCalibrate());

  const sLabel = document.createElement('label'); sLabel.textContent = 'Guitar';
  const rLabel = document.createElement('label'); rLabel.textContent = 'Calibration strength';
  container.append(sLabel, select, rLabel, range, btn);
}
```

- [ ] **Step 4: Run tests** — Run: `npm test tests/calibration-ui.test.js`; then full `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibration/ui.js tests/calibration-ui.test.js
git commit -m "feat: calibration controls UI (profile picker + strength + calibrate)"
```

---

### Task 7: Integration — wire calibration into the live app (manual/by-ear)

**Files:**
- Modify: `src/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `createCalibrationEq` (calibration-eq), `computeCorrection` (correction), `bandPowersFromMagnitudes` (bands), `createAccumulator`/`accumulate`/`fingerprint`/`coverage` (analyzer), all of `profiles.js`, `renderCalibrationControls` (calibration/ui), and the existing engine/preset/ui wiring.

**Wiring requirements:**
- Insert the calibration EQ between source and engine: `source → calibrationEq.input`; `calibrationEq.output → engine.input`. (Preset switching still rebuilds from `engine.input` onward, so it must reconnect `calibrationEq.output → engine.input` on each rebuild, NOT `source → engine.input`.)
- On start: build calibrationEq, load active profile via `getActive()`, and apply `computeCorrection(profile.fingerprint, profile.strength)` (or zeros if none).
- Calibration controls: render via `renderCalibrationControls` with `listProfiles()`, active name, active strength. Handlers:
  - `onSelect(name)` → `setActive(name)`; recompute + `calibrationEq.apply(...)` (zeros if null).
  - `onStrength(s)` → if active profile, `setStrength(activeName, s)`; recompute + apply live.
  - `onCalibrate()` → run the capture wizard.
- Capture wizard: use an `AnalyserNode` tapping `source` (read-only; the same tap as the input meter is fine). On a rAF/interval loop, read `getByteFrequencyData`, convert to linear (`v/255`), compute `bandPowersFromMagnitudes(linearMags, ctx.sampleRate)`, `accumulate(state, powers, peakLevel)`. Update a coverage bar from `coverage(state, minFrames≈ (12s * ~60fps)=720)`. Enable "Save" when `coverage().coverage ≥ 0.9`. On Save: prompt a name, `saveProfile(name, fingerprint(state), currentStrength)`, set active, re-render controls, apply correction.

- [ ] **Step 1: Update `index.html`** — add a calibration panel before the Preset panel:

```html
<div class="panel">
  <label>Guitar calibration</label>
  <div id="calibration"></div>
  <div id="calib-wizard" style="display:none;margin-top:12px">
    <p class="sub" id="calib-instr">Play across the whole neck — low to high — for ~12s.</p>
    <div class="meter-wrap"><div class="meter"><div id="calib-coverage" class="meter-fill"></div></div></div>
    <div class="row" style="margin-top:10px">
      <button id="calib-save" class="primary" disabled>Save guitar…</button>
      <button id="calib-cancel" class="ghost">Cancel</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Update `src/main.js`** — add imports and the wiring. Add near the other imports:

```js
import { createCalibrationEq } from './calibration/calibration-eq.js';
import { computeCorrection } from './calibration/correction.js';
import { bandPowersFromMagnitudes } from './calibration/bands.js';
import { createAccumulator, accumulate, fingerprint, coverage } from './calibration/analyzer.js';
import * as profiles from './calibration/profiles.js';
import { renderCalibrationControls } from './calibration/ui.js';
```

Add module-level state: `let calibrationEq, calibAnalyser, calibRAF, calibState;`

In `start()`, after `source` is created and before loading the preset, build and insert the calibration EQ and its analyser tap:

```js
calibrationEq = createCalibrationEq(ctx);
source.connect(calibrationEq.input);
calibAnalyser = ctx.createAnalyser();
calibAnalyser.fftSize = 2048;
source.connect(calibAnalyser); // read-only tap
applyActiveCalibration();
renderCalibControls();
```

Change preset wiring so the chain is fed by the calibration EQ. In `loadPreset`, replace `source.connect(engine.input)` with `calibrationEq.output.connect(engine.input)`, and on rebuild disconnect the previous `engine`’s input feed by disconnecting `calibrationEq.output` before reconnecting:

```js
function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  if (engine) { try { calibrationEq.output.disconnect(); engine.output.disconnect(); } catch {} }
  engine = buildChain(ctx, preset.chain, registry);
  calibrationEq.output.connect(engine.input);
  engine.output.connect(gainOut);
  renderChain($('chain'), engine.modules, (i, k, v) => engine.setParam(i, k, v));
}
```

Add helpers:

```js
function applyActiveCalibration() {
  const p = profiles.getActive();
  const corr = p ? computeCorrection(p.fingerprint, p.strength) : [];
  calibrationEq.apply(corr.length ? corr : new Array(10).fill(0));
}

function renderCalibControls() {
  const active = profiles.getActive();
  renderCalibrationControls($('calibration'), {
    profiles: profiles.listProfiles(),
    activeName: active ? active.name : null,
    strength: active ? active.strength : 0.65,
  }, {
    onSelect: (name) => { if (name) profiles.setActive(name); else profiles.setActive(null); applyActiveCalibration(); renderCalibControls(); },
    onStrength: (s) => { const a = profiles.getActive(); if (a) profiles.setStrength(a.name, s); applyActiveCalibration(); },
    onCalibrate: startCalibration,
  });
}

function startCalibration() {
  calibState = createAccumulator();
  $('calib-wizard').style.display = 'block';
  $('calib-save').disabled = true;
  const mags = new Uint8Array(calibAnalyser.frequencyBinCount);
  const minFrames = 720; // ~12s @ ~60fps
  const loop = () => {
    calibAnalyser.getByteFrequencyData(mags);
    const lin = Float32Array.from(mags, (v) => v / 255);
    let peak = 0; for (let i = 0; i < lin.length; i++) peak = Math.max(peak, lin[i]);
    const powers = bandPowersFromMagnitudes(lin, ctx.sampleRate);
    accumulate(calibState, powers, peak);
    const c = coverage(calibState, minFrames);
    $('calib-coverage').style.width = (c.coverage * 100) + '%';
    $('calib-save').disabled = c.coverage < 0.9;
    calibRAF = requestAnimationFrame(loop);
  };
  loop();
}

function stopCalibration() {
  if (calibRAF) cancelAnimationFrame(calibRAF);
  calibRAF = null;
  $('calib-wizard').style.display = 'none';
}

function saveCalibration() {
  const name = prompt('Name this guitar (e.g. Strat):');
  if (!name) return;
  const a = profiles.getActive();
  const strength = a ? a.strength : 0.65;
  profiles.saveProfile(name, fingerprint(calibState), strength);
  stopCalibration();
  applyActiveCalibration();
  renderCalibControls();
}

$('calib-save').addEventListener('click', saveCalibration);
$('calib-cancel').addEventListener('click', stopCalibration);
```

Also in `stop()`, add `stopCalibration()` and null out `calibrationEq`/`calibAnalyser`.

- [ ] **Step 3: Syntax + suite check**

Run: `node --check src/main.js` (exit 0) and `npm test` (all existing tests still pass — these files aren't unit-tested).

- [ ] **Step 4: Manual verification in Chrome**

Run: `npm run dev`; open `http://localhost:8000` in Chrome; Start.
1. Calibration shows "None"; tone is the raw guitar through the preset.
2. Click "Calibrate New Guitar"; play across the neck — the coverage bar fills; Save enables near full.
3. Save as "Strat" → it becomes the active profile; tone shifts toward neutral.
4. Move the strength slider 0→100% → hear the correction scale (0 = identical to raw).
5. Switch artist presets → calibration persists underneath.
6. Reload the page, Start → the saved profile is still listed and active.
Expected: all pass. Tone judgments are by ear.

- [ ] **Step 5: Commit**

```bash
git add src/main.js index.html
git commit -m "feat: wire guitar calibration into the live app"
```

---

## Notes for the executor

- **The calibration EQ feeds the chain, not the source.** On every preset rebuild, reconnect `calibrationEq.output → engine.input`. Forgetting this silences the app or bypasses calibration — check it explicitly.
- **The analyser is a read-only tap** off `source`; never insert it in series.
- **Coverage tuning is by feel.** `minFrames=720` assumes ~60fps; if capture feels too long/short, adjust. Not a test failure.
- **Per-instance schema/clicks:** like the effects layer, `apply` sets `.value` directly; smoothing param changes (`setTargetAtTime`) is a possible later polish, consistent with the effects layer decision.
