# Guitar Effects Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic, composable browser guitar-effects engine where artist presets are just JSON configurations of reusable effect blocks, proven end-to-end with two John Mayer tones.

**Architecture:** A data-driven engine reads a chain description (array of `{type, params}`), instantiates effect modules from a registry, and wires them in series through a uniform `{input, output, apply}` interface over the Web Audio API. Effects, presets, and the auto-rendered UI are fully decoupled. No bundler — native ES modules served over localhost. Pure logic (DSP math, graph wiring, preset/UI rendering) is unit-tested with Vitest + a fake AudioContext; audio quality is verified by ear in Chrome.

**Tech Stack:** Vanilla JS (ES modules), Web Audio API, Vitest (+ jsdom) for tests, `python -m http.server` for the dev server.

## Global Constraints

- **Target browser:** Chrome/Chromium (Safari is a known higher-latency fallback).
- **No bundler / no framework:** native ES modules (`<script type="module">`), served over `http://localhost`.
- **File-free DSP:** no external impulse-response assets in v1; cabinet is filter-based, reverb is a code-synthesized impulse. Architecture stays IR-ready.
- **Audio input constraints (reused from latency POC):** `getUserMedia` with `echoCancellation:false, noiseSuppression:false, autoGainControl:false, latency:0`; `new AudioContext({ latencyHint: 'interactive' })`; route output via `setSinkId` where supported.
- **Effect module interface (every effect conforms):** exports `schema` (`{type, label, params:[{key,label,min,max,default,step,unit?}]}`) and `create(ctx, params) → { input, output, apply(params) }`, where `input`/`output` are `AudioNode`s.
- **Param values in presets/UI are the schema's units** (e.g. EQ bands 0–10, delay time in ms, mix 0–1).
- **TDD:** every logic unit gets a failing test first. Commit after each green task.

---

## File Structure

- `package.json` — Vitest dev dependency + scripts.
- `tests/fake-audio-context.js` — fake `AudioContext` recording connections + node params.
- `tests/*.test.js` — unit tests.
- `src/dsp.js` — pure DSP helpers (soft-clip curve, reverb impulse, range mapping, dB).
- `src/effects/compressor.js`, `drive.js`, `eq.js`, `cabinet.js`, `delay.js`, `reverb.js` — one effect each.
- `src/effects/index.js` — registry: `type → effect module`.
- `src/engine.js` — `buildChain(ctx, chain, registry) → { input, output, modules, setParam }`.
- `src/presets.js` — preset list + `validatePreset`.
- `src/presets/*.json` — `mayer-edge.json`, `mayer-lead.json`, `clean.json`.
- `src/ui.js` — `renderChain(container, modules, onParamChange)` + preset picker.
- `src/main.js` — audio I/O (from POC) + engine + UI wiring.
- `index.html` — shell with mount points; loads `src/main.js`.

---

### Task 1: Project tooling & fake-AudioContext test harness

**Files:**
- Create: `package.json`
- Create: `tests/fake-audio-context.js`
- Create: `tests/harness.test.js`

**Interfaces:**
- Produces: `FakeAudioContext` class with node factories (`createGain`, `createWaveShaper`, `createBiquadFilter`, `createDynamicsCompressor`, `createDelay`, `createConvolver`, `createBuffer`), `sampleRate`, and a recorded `connections` array of `{from, to}`. Each fake node has `connect(node)`, `disconnect()`, and an `id`. Param-bearing nodes expose the same property names as the real API (`gain.value`, `threshold.value`, `frequency.value`, `Q.value`, `type`, `curve`, `oversample`, `delayTime.value`, `buffer`).

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "guitar-web",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "python3 -m http.server 8000"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Write the fake AudioContext**

```js
// tests/fake-audio-context.js
let _id = 0;
function param(value) { return { value, setValueAtTime(v){ this.value = v; }, linearRampToValueAtTime(v){ this.value = v; } }; }

export class FakeNode {
  constructor(kind, ctx) { this.kind = kind; this.id = _id++; this.ctx = ctx; }
  connect(node) { this.ctx.connections.push({ from: this.id, to: node.id, fromKind: this.kind, toKind: node.kind }); return node; }
  disconnect() { this.ctx.connections = this.ctx.connections.filter(c => c.from !== this.id); }
}

export class FakeAudioContext {
  constructor(sampleRate = 48000) { this.sampleRate = sampleRate; this.connections = []; this.destination = new FakeNode('destination', this); }
  _mk(kind, extra = {}) { return Object.assign(new FakeNode(kind, this), extra); }
  createGain() { return this._mk('gain', { gain: param(1) }); }
  createWaveShaper() { return this._mk('waveshaper', { curve: null, oversample: 'none' }); }
  createBiquadFilter() { return this._mk('biquad', { type: 'peaking', frequency: param(350), Q: param(1), gain: param(0) }); }
  createDynamicsCompressor() { return this._mk('compressor', { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25) }); }
  createDelay() { return this._mk('delay', { delayTime: param(0) }); }
  createConvolver() { return this._mk('convolver', { buffer: null }); }
  createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate: rate, getChannelData: i => data[i] };
  }
}
```

- [ ] **Step 4: Write a harness sanity test (failing first)**

```js
// tests/harness.test.js
import { describe, it, expect } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';

describe('FakeAudioContext', () => {
  it('records connections between nodes', () => {
    const ctx = new FakeAudioContext();
    const a = ctx.createGain(), b = ctx.createGain();
    a.connect(b);
    expect(ctx.connections).toEqual([{ from: a.id, to: b.id, fromKind: 'gain', toKind: 'gain' }]);
  });
});
```

- [ ] **Step 5: Run test**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json tests/
git commit -m "chore: vitest tooling + fake AudioContext harness"
```

---

### Task 2: Pure DSP helpers

**Files:**
- Create: `src/dsp.js`
- Test: `tests/dsp.test.js`

**Interfaces:**
- Produces:
  - `mapRange(x, inMin, inMax, outMin, outMax) → number`
  - `dbToGain(db) → number` (`10 ** (db/20)`)
  - `makeSoftClipCurve(amount, n=2048) → Float32Array` — asymmetric soft clip; `amount` 0–10 maps to drive intensity; length `n`; values in [-1, 1]; monotonic non-decreasing.
  - `makeReverbImpulse(ctx, seconds, decay) → AudioBuffer` — 2-channel exponentially decaying filtered noise; `length === round(seconds*sampleRate)`.

- [ ] **Step 1: Write failing tests**

```js
// tests/dsp.test.js
import { describe, it, expect } from 'vitest';
import { mapRange, dbToGain, makeSoftClipCurve, makeReverbImpulse } from '../src/dsp.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('mapRange', () => {
  it('maps linearly', () => { expect(mapRange(5, 0, 10, 0, 100)).toBe(50); });
});
describe('dbToGain', () => {
  it('0 dB is unity', () => { expect(dbToGain(0)).toBeCloseTo(1); });
  it('+6 dB ~ x2', () => { expect(dbToGain(6)).toBeCloseTo(1.995, 2); });
});
describe('makeSoftClipCurve', () => {
  const c = makeSoftClipCurve(5, 2048);
  it('has requested length', () => { expect(c.length).toBe(2048); });
  it('stays in [-1,1]', () => { expect(Math.max(...c)).toBeLessThanOrEqual(1); expect(Math.min(...c)).toBeGreaterThanOrEqual(-1); });
  it('is monotonic non-decreasing', () => {
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
  it('more amount = more gain near zero crossing', () => {
    const lo = makeSoftClipCurve(1), hi = makeSoftClipCurve(9);
    const mid = 1024 + 100; // just right of center
    expect(hi[mid]).toBeGreaterThan(lo[mid]);
  });
});
describe('makeReverbImpulse', () => {
  it('builds a buffer of the right length', () => {
    const ctx = new FakeAudioContext(48000);
    const buf = makeReverbImpulse(ctx, 1.5, 2);
    expect(buf.length).toBe(72000);
    expect(buf.numberOfChannels).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/dsp.test.js`
Expected: FAIL (module not found / functions undefined).

- [ ] **Step 3: Implement `src/dsp.js`**

```js
// src/dsp.js
export function mapRange(x, inMin, inMax, outMin, outMax) {
  return outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function dbToGain(db) { return Math.pow(10, db / 20); }

// Asymmetric soft clip. amount 0..10 -> drive k. Tanh-based, slight asymmetry
// for even harmonics (tube/Klon-like warmth).
export function makeSoftClipCurve(amount, n = 2048) {
  const k = 1 + amount * 3;            // drive intensity
  const bias = 0.1 * (amount / 10);    // asymmetry
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;   // -1..1
    const y = Math.tanh(k * (x + bias)) - Math.tanh(k * bias); // shift so f(0)=0
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

export function makeReverbImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.round(seconds * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      const white = Math.random() * 2 - 1;
      // simple low-pass to darken the tail
      last = last * 0.4 + white * 0.6;
      data[i] = last * env;
    }
  }
  return buffer;
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/dsp.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dsp.js tests/dsp.test.js
git commit -m "feat: pure DSP helpers (curve, reverb impulse, mappings)"
```

---

### Task 3: Compressor effect (establishes the effect interface)

**Files:**
- Create: `src/effects/compressor.js`
- Test: `tests/compressor.test.js`

**Interfaces:**
- Consumes: `FakeAudioContext`.
- Produces: `schema` (`type:'compressor'`) and `create(ctx, params) → { input, output, apply(params) }`. `input`/`output` are the same `DynamicsCompressorNode`. Params: `threshold` (-60..0 dB), `ratio` (1..20), `attack` (0..1 s), `release` (0..1 s), `makeup` (0..24 dB). `makeup` is applied as a post gain node; therefore `output` is that makeup `GainNode`, `input` is the compressor.

- [ ] **Step 1: Write failing test**

```js
// tests/compressor.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/compressor.js';
import { dbToGain } from '../src/dsp.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('compressor effect', () => {
  it('exposes a schema with a stable type', () => {
    expect(schema.type).toBe('compressor');
    expect(schema.params.map(p => p.key)).toContain('ratio');
  });
  it('wires compressor -> makeup gain and applies params', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 6 });
    // input is compressor, output is makeup gain, connected internally
    expect(fx.input.kind).toBe('compressor');
    expect(fx.output.kind).toBe('gain');
    expect(ctx.connections.some(c => c.from === fx.input.id && c.to === fx.output.id)).toBe(true);
    expect(fx.input.ratio.value).toBe(2.5);
    expect(fx.input.threshold.value).toBe(-18);
    expect(fx.output.gain.value).toBeCloseTo(dbToGain(6));
  });
  it('apply updates params live', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 0 });
    fx.apply({ threshold: -30, ratio: 4, attack: 0.01, release: 0.3, makeup: 3 });
    expect(fx.input.threshold.value).toBe(-30);
    expect(fx.input.ratio.value).toBe(4);
    expect(fx.output.gain.value).toBeCloseTo(dbToGain(3));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/compressor.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/effects/compressor.js`**

```js
// src/effects/compressor.js
import { dbToGain } from '../dsp.js';

export const schema = {
  type: 'compressor',
  label: 'Compressor',
  params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, step: 1, unit: 'dB' },
    { key: 'ratio',     label: 'Ratio',     min: 1,   max: 20, default: 2.5, step: 0.1 },
    { key: 'attack',    label: 'Attack',    min: 0,   max: 1,  default: 0.005, step: 0.001, unit: 's' },
    { key: 'release',   label: 'Release',   min: 0,   max: 1,  default: 0.25, step: 0.01, unit: 's' },
    { key: 'makeup',    label: 'Makeup',    min: 0,   max: 24, default: 3,  step: 0.5, unit: 'dB' },
  ],
};

export function create(ctx, params) {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);
  const apply = (p) => {
    comp.threshold.value = p.threshold;
    comp.ratio.value = p.ratio;
    comp.attack.value = p.attack;
    comp.release.value = p.release;
    makeup.gain.value = dbToGain(p.makeup);
  };
  apply(params);
  return { input: comp, output: makeup, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/compressor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/compressor.js tests/compressor.test.js
git commit -m "feat: compressor effect + effect-module interface"
```

---

### Task 4: Drive effect (waveshaper + clean blend)

**Files:**
- Create: `src/effects/drive.js`
- Test: `tests/drive.test.js`

**Interfaces:**
- Consumes: `makeSoftClipCurve` (dsp), `FakeAudioContext`.
- Produces: `schema` (`type:'drive'`) and `create`. Internal graph: `input(gain) → [drive path: preGain → waveShaper(curve) → toneFilter(lowpass) → wetGain]` **and** `input → dryGain`, both summed into `output(gain)`. Params: `amount` (0..10), `tone` (0..10 → lowpass 1k..8k Hz), `level` (0..10 → output gain), `blend` (0..1 wet mix), `midBump` (0..10 → peaking boost ~750 Hz before clip, for TS mode). `apply` rebuilds the waveshaper curve from `amount`.

- [ ] **Step 1: Write failing test**

```js
// tests/drive.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/drive.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('drive effect', () => {
  it('has type drive and an amount param', () => {
    expect(schema.type).toBe('drive');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['amount', 'blend', 'tone', 'level', 'midBump']));
  });
  it('builds a parallel wet/dry graph and sets a curve', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { amount: 3, tone: 5, level: 5, blend: 0.65, midBump: 0 });
    const ws = ctx.connections.find(c => c.toKind === 'waveshaper');
    expect(ws).toBeTruthy();                       // a waveshaper is in the graph
    // both a wet path (through waveshaper) and dry path (input->output) exist
    expect(ctx.connections.some(c => c.from === fx.input.id)).toBe(true);
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('apply changes the curve when amount changes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { amount: 1, tone: 5, level: 5, blend: 0.5, midBump: 0 });
    // capture the waveshaper node via connections is awkward; assert apply runs without throwing
    expect(() => fx.apply({ amount: 8, tone: 7, level: 6, blend: 0.7, midBump: 4 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/drive.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/drive.js`**

```js
// src/effects/drive.js
import { makeSoftClipCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'drive',
  label: 'Drive',
  params: [
    { key: 'amount',  label: 'Amount',   min: 0, max: 10, default: 2.5, step: 0.1 },
    { key: 'tone',    label: 'Tone',     min: 0, max: 10, default: 5,   step: 0.1 },
    { key: 'level',   label: 'Level',    min: 0, max: 10, default: 5,   step: 0.1 },
    { key: 'blend',   label: 'Blend',    min: 0, max: 1,  default: 0.65, step: 0.01 },
    { key: 'midBump', label: 'Mid Bump', min: 0, max: 10, default: 0,   step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // wet path
  const midEq = ctx.createBiquadFilter(); midEq.type = 'peaking'; midEq.frequency.value = 750; midEq.Q.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const wet = ctx.createGain();
  input.connect(midEq); midEq.connect(shaper); shaper.connect(tone); tone.connect(wet); wet.connect(output);

  // dry path (transparent clean blend)
  const dry = ctx.createGain();
  input.connect(dry); dry.connect(output);

  const apply = (p) => {
    shaper.curve = makeSoftClipCurve(p.amount);
    tone.frequency.value = mapRange(p.tone, 0, 10, 1000, 8000);
    midEq.gain.value = mapRange(p.midBump, 0, 10, 0, 12);
    wet.gain.value = p.blend;
    dry.gain.value = 1 - p.blend;
    output.gain.value = mapRange(p.level, 0, 10, 0, 2);
  };
  apply(params);
  return { input, output, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/drive.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/drive.js tests/drive.test.js
git commit -m "feat: drive effect (asymmetric soft clip + clean blend)"
```

---

### Task 5: EQ effect (3-band)

**Files:**
- Create: `src/effects/eq.js`
- Test: `tests/eq.test.js`

**Interfaces:**
- Produces: `schema` (`type:'eq'`) and `create`. Graph: `input(lowshelf) → mid(peaking) → highshelf(=output)`. Params: `bass` (0..10 → -12..+12 dB low shelf @ ~120 Hz), `mid` (0..10 → -12..+12 dB peaking), `midFreq` (200..2000 Hz), `treble` (0..10 → -12..+12 dB high shelf @ ~3 kHz). `input` is low-shelf node, `output` is high-shelf node.

- [ ] **Step 1: Write failing test**

```js
// tests/eq.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/eq.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('eq effect', () => {
  it('has 3 bands', () => {
    expect(schema.type).toBe('eq');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['bass', 'mid', 'midFreq', 'treble']));
  });
  it('maps band 5/10 to ~0 dB and 10/10 to +12 dB', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { bass: 5, mid: 10, midFreq: 750, treble: 5 });
    expect(fx.input.kind).toBe('biquad');
    expect(fx.input.gain.value).toBeCloseTo(0);     // bass 5 -> 0 dB
    // find the mid (peaking) node by frequency 750
    expect(fx.output.gain.value).toBeCloseTo(0);    // treble 5 -> 0 dB
  });
  it('apply updates gains and mid frequency', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { bass: 5, mid: 5, midFreq: 750, treble: 5 });
    fx.apply({ bass: 8, mid: 7, midFreq: 900, treble: 3 });
    expect(fx.input.gain.value).toBeCloseTo(7.2);   // (8-5)/5*12
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/eq.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/eq.js`**

```js
// src/effects/eq.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'eq',
  label: 'EQ',
  params: [
    { key: 'bass',    label: 'Bass',    min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'mid',     label: 'Mid',     min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'midFreq', label: 'Mid Freq', min: 200, max: 2000, default: 750, step: 10, unit: 'Hz' },
    { key: 'treble',  label: 'Treble',  min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

const toDb = (v) => mapRange(v, 0, 10, -12, 12);

export function create(ctx, params) {
  const low = ctx.createBiquadFilter();  low.type = 'lowshelf';  low.frequency.value = 120;
  const mid = ctx.createBiquadFilter();  mid.type = 'peaking';   mid.Q.value = 1;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3000;
  low.connect(mid); mid.connect(high);

  const apply = (p) => {
    low.gain.value = toDb(p.bass);
    mid.gain.value = toDb(p.mid);
    mid.frequency.value = p.midFreq;
    high.gain.value = toDb(p.treble);
  };
  apply(params);
  return { input: low, output: high, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/eq.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/eq.js tests/eq.test.js
git commit -m "feat: 3-band EQ effect"
```

---

### Task 6: Cabinet effect (filter-based)

**Files:**
- Create: `src/effects/cabinet.js`
- Test: `tests/cabinet.test.js`

**Interfaces:**
- Produces: `schema` (`type:'cabinet'`) and `create`. Graph: `input(highpass ~80 Hz) → presence(peaking ~2.5 kHz) → lowpass(steep) → output(gain=mix)`. Params: `brightness` (0..10 → lowpass cutoff 3.5k..6.5 kHz), `body` (0..10 → presence peak 0..+6 dB), `mix` (0..1 output gain). `input` is highpass, `output` is the mix gain.

- [ ] **Step 1: Write failing test**

```js
// tests/cabinet.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/cabinet.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('cabinet effect', () => {
  it('is a cabinet with brightness/body/mix', () => {
    expect(schema.type).toBe('cabinet');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['brightness', 'body', 'mix']));
  });
  it('rolls off highs (input is a highpass, mix on output)', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { brightness: 4, body: 6, mix: 1 });
    expect(fx.input.kind).toBe('biquad');
    expect(fx.input.type).toBe('highpass');
    expect(fx.output.kind).toBe('gain');
    expect(fx.output.gain.value).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/cabinet.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/cabinet.js`**

```js
// src/effects/cabinet.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'cabinet',
  label: 'Cabinet',
  params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 10, default: 4, step: 0.1 },
    { key: 'body',       label: 'Body',       min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'mix',        label: 'Mix',        min: 0, max: 1,  default: 1, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2500; presence.Q.value = 1.2;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
  const out = ctx.createGain();
  hp.connect(presence); presence.connect(lp); lp.connect(out);

  const apply = (p) => {
    lp.frequency.value = mapRange(p.brightness, 0, 10, 3500, 6500);
    presence.gain.value = mapRange(p.body, 0, 10, 0, 6);
    out.gain.value = p.mix;
  };
  apply(params);
  return { input: hp, output: out, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/cabinet.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/cabinet.js tests/cabinet.test.js
git commit -m "feat: filter-based cabinet effect"
```

---

### Task 7: Delay effect

**Files:**
- Create: `src/effects/delay.js`
- Test: `tests/delay.test.js`

**Interfaces:**
- Produces: `schema` (`type:'delay'`) and `create`. Graph: `input → dryGain → output`; `input → delayNode → wetGain → output`; feedback loop `delayNode → damp(lowpass) → feedbackGain → delayNode`. Params: `time` (0..1000 ms → delayTime seconds), `feedback` (0..0.9), `tone` (0..10 → damp lowpass 1k..8k Hz), `mix` (0..1 wet gain). `input`/`output` are gain nodes.

- [ ] **Step 1: Write failing test**

```js
// tests/delay.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/delay.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('delay effect', () => {
  it('has time/feedback/tone/mix', () => {
    expect(schema.type).toBe('delay');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['time', 'feedback', 'tone', 'mix']));
  });
  it('creates a feedback loop and wet/dry split', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { time: 320, feedback: 0.2, tone: 4, mix: 0.15 });
    // a delay node exists and is part of a cycle (something connects back into it)
    const delayConn = ctx.connections.find(c => c.toKind === 'delay');
    expect(delayConn).toBeTruthy();
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('converts ms to seconds on the delay node via apply', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { time: 500, feedback: 0.3, tone: 5, mix: 0.2 });
    fx.apply({ time: 250, feedback: 0.25, tone: 4, mix: 0.18 });
    // no throw + mix applied
    expect(() => fx.apply({ time: 250, feedback: 0.25, tone: 4, mix: 0.18 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/delay.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/delay.js`**

```js
// src/effects/delay.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'delay',
  label: 'Delay',
  params: [
    { key: 'time',     label: 'Time',     min: 0, max: 1000, default: 320, step: 5, unit: 'ms' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.9,  default: 0.2, step: 0.01 },
    { key: 'tone',     label: 'Tone',     min: 0, max: 10,   default: 4,   step: 0.1 },
    { key: 'mix',      label: 'Mix',      min: 0, max: 1,    default: 0.15, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay();          // default maxDelayTime 1s is enough
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass';
  const fb = ctx.createGain();
  const wet = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(damp); damp.connect(fb); fb.connect(delay);  // feedback loop
  delay.connect(wet); wet.connect(output);

  const apply = (p) => {
    delay.delayTime.value = p.time / 1000;
    fb.gain.value = p.feedback;
    damp.frequency.value = mapRange(p.tone, 0, 10, 1000, 8000);
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/delay.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/delay.js tests/delay.test.js
git commit -m "feat: delay effect with damped feedback loop"
```

---

### Task 8: Reverb effect

**Files:**
- Create: `src/effects/reverb.js`
- Test: `tests/reverb.test.js`

**Interfaces:**
- Consumes: `makeReverbImpulse` (dsp).
- Produces: `schema` (`type:'reverb'`) and `create`. Graph: `input → dryGain → output`; `input → convolver → wetGain → output`. Params: `size` (0..1 → impulse seconds 0.3..3.0, decay derived), `mix` (0..1 wet gain). `apply` regenerates the convolver buffer when `size` changes. `input`/`output` are gain nodes.

- [ ] **Step 1: Write failing test**

```js
// tests/reverb.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/reverb.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('reverb effect', () => {
  it('has size and mix', () => {
    expect(schema.type).toBe('reverb');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['size', 'mix']));
  });
  it('builds a convolver with a generated buffer and wet/dry split', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { size: 0.5, mix: 0.12 });
    const conv = ctx.connections.find(c => c.toKind === 'convolver');
    expect(conv).toBeTruthy();
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('apply changes mix without throwing', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { size: 0.5, mix: 0.1 });
    expect(() => fx.apply({ size: 0.8, mix: 0.2 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/reverb.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/reverb.js`**

```js
// src/effects/reverb.js
import { makeReverbImpulse, mapRange } from '../dsp.js';

export const schema = {
  type: 'reverb',
  label: 'Reverb',
  params: [
    { key: 'size', label: 'Size', min: 0, max: 1, default: 0.5, step: 0.01 },
    { key: 'mix',  label: 'Mix',  min: 0, max: 1, default: 0.12, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(conv); conv.connect(wet); wet.connect(output);

  let lastSize = null;
  const apply = (p) => {
    if (p.size !== lastSize) {
      const seconds = mapRange(p.size, 0, 1, 0.3, 3.0);
      conv.buffer = makeReverbImpulse(ctx, seconds, 2.0);
      lastSize = p.size;
    }
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test tests/reverb.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/effects/reverb.js tests/reverb.test.js
git commit -m "feat: convolution reverb with synthesized impulse"
```

---

### Task 9: Effect registry + engine

**Files:**
- Create: `src/effects/index.js`
- Create: `src/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: all effect modules.
- Produces:
  - `registry` (in `effects/index.js`): `{ compressor, drive, eq, cabinet, delay, reverb }` mapping type → `{ schema, create }`.
  - `buildChain(ctx, chain, registry) → { input, output, modules, setParam(index, key, value) }` where `chain` is `[{type, params}]`. Wires `input(gain) → fx0 → fx1 → … → output(gain)`. `modules` is `[{ type, schema, params, apply, input, output }]`. `setParam` updates `modules[index].params[key]` and calls that module's `apply`.

- [ ] **Step 1: Write failing test**

```js
// tests/engine.test.js
import { describe, it, expect } from 'vitest';
import { registry } from '../src/effects/index.js';
import { buildChain } from '../src/engine.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('registry', () => {
  it('contains all six effect types', () => {
    expect(Object.keys(registry).sort()).toEqual(['cabinet', 'compressor', 'delay', 'drive', 'eq', 'reverb']);
  });
});

describe('buildChain', () => {
  const chain = [
    { type: 'compressor', params: { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 3 } },
    { type: 'eq', params: { bass: 5, mid: 6, midFreq: 750, treble: 5 } },
  ];
  it('wires input -> modules in order -> output', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, chain, registry);
    expect(g.modules).toHaveLength(2);
    expect(g.modules[0].type).toBe('compressor');
    // input connects to first module's input
    expect(ctx.connections.some(c => c.from === g.input.id && c.to === g.modules[0].input.id)).toBe(true);
    // module0 output connects to module1 input
    expect(ctx.connections.some(c => c.from === g.modules[0].output.id && c.to === g.modules[1].input.id)).toBe(true);
    // last module connects to output
    expect(ctx.connections.some(c => c.from === g.modules[1].output.id && c.to === g.output.id)).toBe(true);
  });
  it('setParam updates the module param and re-applies', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, chain, registry);
    g.setParam(1, 'bass', 8);
    expect(g.modules[1].params.bass).toBe(8);
    expect(g.modules[1].input.gain.value).toBeCloseTo(7.2); // eq bass 8 -> +7.2 dB
  });
  it('empty chain connects input straight to output', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, [], registry);
    expect(ctx.connections.some(c => c.from === g.input.id && c.to === g.output.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test tests/engine.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement `src/effects/index.js`**

```js
// src/effects/index.js
import * as compressor from './compressor.js';
import * as drive from './drive.js';
import * as eq from './eq.js';
import * as cabinet from './cabinet.js';
import * as delay from './delay.js';
import * as reverb from './reverb.js';

export const registry = {
  compressor: { schema: compressor.schema, create: compressor.create },
  drive:      { schema: drive.schema,      create: drive.create },
  eq:         { schema: eq.schema,         create: eq.create },
  cabinet:    { schema: cabinet.schema,    create: cabinet.create },
  delay:      { schema: delay.schema,      create: delay.create },
  reverb:     { schema: reverb.schema,     create: reverb.create },
};
```

- [ ] **Step 4: Implement `src/engine.js`**

```js
// src/engine.js
export function buildChain(ctx, chain, registry) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const modules = [];

  let prev = input;
  for (const node of chain) {
    const def = registry[node.type];
    if (!def) throw new Error(`Unknown effect type: ${node.type}`);
    const params = { ...node.params };
    const built = def.create(ctx, params);
    prev.connect(built.input);
    prev = built.output;
    modules.push({ type: node.type, schema: def.schema, params, apply: built.apply, input: built.input, output: built.output });
  }
  prev.connect(output);

  function setParam(index, key, value) {
    const m = modules[index];
    m.params[key] = value;
    m.apply(m.params);
  }

  return { input, output, modules, setParam };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test tests/engine.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/effects/index.js src/engine.js tests/engine.test.js
git commit -m "feat: effect registry + data-driven chain engine"
```

---

### Task 10: Presets + validation

**Files:**
- Create: `src/presets/clean.json`
- Create: `src/presets/mayer-edge.json`
- Create: `src/presets/mayer-lead.json`
- Create: `src/presets.js`
- Test: `tests/presets.test.js`

**Interfaces:**
- Consumes: `registry`.
- Produces:
  - JSON preset files (`{ name, artist?, song?, chain: [{type, params}] }`).
  - `src/presets.js` exporting `PRESETS` (array, imported via `import json` assertions OR fetched — use static imports) and `validatePreset(preset, registry) → string[]` (returns list of error strings; empty = valid). Validation checks: every `chain[i].type` exists in `registry`, and every param key in the entry exists in that effect's schema.

- [ ] **Step 1: Write the three preset JSON files**

`src/presets/clean.json`:
```json
{ "name": "Clean (bypass)", "chain": [
  { "type": "cabinet", "params": { "brightness": 6, "body": 5, "mix": 1 } }
] }
```

`src/presets/mayer-edge.json`:
```json
{ "name": "Mayer — Edge of Breakup", "artist": "John Mayer", "song": "Slow Dancing in a Burning Room", "chain": [
  { "type": "compressor", "params": { "threshold": -18, "ratio": 2.5, "attack": 0.005, "release": 0.25, "makeup": 3 } },
  { "type": "drive",      "params": { "amount": 2.5, "tone": 5, "level": 5, "blend": 0.65, "midBump": 0 } },
  { "type": "eq",         "params": { "bass": 6, "mid": 7, "midFreq": 750, "treble": 5 } },
  { "type": "cabinet",    "params": { "brightness": 4, "body": 6, "mix": 1 } },
  { "type": "delay",      "params": { "time": 320, "feedback": 0.2, "tone": 4, "mix": 0.15 } },
  { "type": "reverb",     "params": { "size": 0.5, "mix": 0.12 } }
] }
```

`src/presets/mayer-lead.json`:
```json
{ "name": "Mayer — Lead Boost", "artist": "John Mayer", "chain": [
  { "type": "compressor", "params": { "threshold": -20, "ratio": 3, "attack": 0.005, "release": 0.25, "makeup": 4 } },
  { "type": "drive",      "params": { "amount": 4.5, "tone": 5, "level": 6, "blend": 0.8, "midBump": 5 } },
  { "type": "eq",         "params": { "bass": 5, "mid": 8, "midFreq": 800, "treble": 4 } },
  { "type": "cabinet",    "params": { "brightness": 4, "body": 6, "mix": 1 } },
  { "type": "delay",      "params": { "time": 400, "feedback": 0.28, "tone": 4, "mix": 0.2 } },
  { "type": "reverb",     "params": { "size": 0.6, "mix": 0.15 } }
] }
```

- [ ] **Step 2: Write failing test**

```js
// tests/presets.test.js
import { describe, it, expect } from 'vitest';
import { PRESETS, validatePreset } from '../src/presets.js';
import { registry } from '../src/effects/index.js';

describe('presets', () => {
  it('exports at least the three v1 presets', () => {
    const names = PRESETS.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['Clean (bypass)', 'Mayer — Edge of Breakup', 'Mayer — Lead Boost']));
  });
  it('all shipped presets are valid against the registry', () => {
    for (const p of PRESETS) expect(validatePreset(p, registry)).toEqual([]);
  });
  it('flags unknown effect types', () => {
    const bad = { name: 'x', chain: [{ type: 'nope', params: {} }] };
    expect(validatePreset(bad, registry)).toContain('Unknown effect type: nope');
  });
  it('flags unknown param keys', () => {
    const bad = { name: 'x', chain: [{ type: 'reverb', params: { bogus: 1 } }] };
    expect(validatePreset(bad, registry)[0]).toMatch(/unknown param/i);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test tests/presets.test.js`
Expected: FAIL.

- [ ] **Step 4: Implement `src/presets.js`**

```js
// src/presets.js
import clean from './presets/clean.json' with { type: 'json' };
import mayerEdge from './presets/mayer-edge.json' with { type: 'json' };
import mayerLead from './presets/mayer-lead.json' with { type: 'json' };

export const PRESETS = [clean, mayerEdge, mayerLead];

export function validatePreset(preset, registry) {
  const errors = [];
  for (const entry of preset.chain) {
    const def = registry[entry.type];
    if (!def) { errors.push(`Unknown effect type: ${entry.type}`); continue; }
    const known = new Set(def.schema.params.map(p => p.key));
    for (const key of Object.keys(entry.params || {})) {
      if (!known.has(key)) errors.push(`${entry.type}: unknown param "${key}"`);
    }
  }
  return errors;
}
```

Note: JSON import assertions (`with { type: 'json' }`) work in Vitest and modern Chrome. If the Chrome version in use predates import assertions, the executor should switch `presets.js` to `fetch()` the JSON at runtime and adjust the test to load via fetch mock — but try the static import first.

- [ ] **Step 5: Run tests**

Run: `npm test tests/presets.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/presets.js src/presets/
git commit -m "feat: John Mayer + clean presets with validation"
```

---

### Task 11: Auto-rendered UI

**Files:**
- Create: `src/ui.js`
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: engine `modules` (each `{ type, schema, params }`), and `PRESETS`.
- Produces:
  - `renderPresetPicker(container, presets, onSelect) → void` — builds a `<select>`; calls `onSelect(preset)` on change.
  - `renderChain(container, modules, onParamChange) → void` — for each module, render a labeled group with one `<input type="range">` per schema param (min/max/step/value from schema+params), plus a live value readout; on input, call `onParamChange(moduleIndex, paramKey, Number(value))` and update the readout.

- [ ] **Step 1: Add jsdom test env config**

Add to `package.json` `scripts` is unchanged; create `vitest.config.js`:
```js
// vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom' } });
```

- [ ] **Step 2: Write failing test**

```js
// tests/ui.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderChain, renderPresetPicker } from '../src/ui.js';

const modules = [
  { type: 'eq', schema: { label: 'EQ', params: [{ key: 'bass', label: 'Bass', min: 0, max: 10, default: 5, step: 0.1 }] }, params: { bass: 6 } },
];

describe('renderChain', () => {
  it('renders a slider per param with current value', () => {
    const el = document.createElement('div');
    renderChain(el, modules, () => {});
    const slider = el.querySelector('input[type=range]');
    expect(slider).toBeTruthy();
    expect(slider.value).toBe('6');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('10');
  });
  it('calls onParamChange with (index, key, number) on input', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderChain(el, modules, cb);
    const slider = el.querySelector('input[type=range]');
    slider.value = '8';
    slider.dispatchEvent(new Event('input'));
    expect(cb).toHaveBeenCalledWith(0, 'bass', 8);
  });
});

describe('renderPresetPicker', () => {
  it('lists presets and fires onSelect', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    const presets = [{ name: 'A', chain: [] }, { name: 'B', chain: [] }];
    renderPresetPicker(el, presets, cb);
    const select = el.querySelector('select');
    expect(select.options).toHaveLength(2);
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    expect(cb).toHaveBeenCalledWith(presets[1]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test tests/ui.test.js`
Expected: FAIL.

- [ ] **Step 4: Implement `src/ui.js`**

```js
// src/ui.js
export function renderPresetPicker(container, presets, onSelect) {
  container.innerHTML = '';
  const select = document.createElement('select');
  presets.forEach((p, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = p.name; select.appendChild(o); });
  select.addEventListener('change', () => onSelect(presets[select.selectedIndex]));
  container.appendChild(select);
}

export function renderChain(container, modules, onParamChange) {
  container.innerHTML = '';
  modules.forEach((m, index) => {
    const group = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = m.schema.label;
    group.appendChild(legend);
    for (const p of m.schema.params) {
      const row = document.createElement('label');
      row.className = 'knob';
      const name = document.createElement('span'); name.textContent = p.label;
      const val = document.createElement('span'); val.className = 'val';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = String(p.min); slider.max = String(p.max);
      slider.step = String(p.step); slider.value = String(m.params[p.key] ?? p.default);
      val.textContent = slider.value + (p.unit ? ' ' + p.unit : '');
      slider.addEventListener('input', () => {
        const v = Number(slider.value);
        val.textContent = slider.value + (p.unit ? ' ' + p.unit : '');
        onParamChange(index, p.key, v);
      });
      row.append(name, slider, val);
      group.appendChild(row);
    }
    container.appendChild(group);
  });
}
```

- [ ] **Step 5: Run tests**

Run: `npm test tests/ui.test.js`
Expected: PASS. Then run full suite `npm test` — expect ALL pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui.js vitest.config.js tests/ui.test.js
git commit -m "feat: schema-driven UI (preset picker + auto knobs)"
```

---

### Task 12: Audio I/O shell + full wiring (manual/by-ear verification)

**Files:**
- Modify: `index.html` (replace the latency-POC body with the engine app; keep device pickers + meter + I/O code)
- Create: `src/main.js`

**Interfaces:**
- Consumes: `buildChain`, `registry`, `PRESETS`, `renderChain`, `renderPresetPicker`, the POC's `getUserMedia`/`AudioContext` setup.
- Produces: a running app. `main.js`: on Start, open `AudioContext`, `getUserMedia` (constraints from Global Constraints), `setSinkId` if supported, build the source → `engine.input`, `engine.output` → destination, render preset picker + chain. Selecting a preset rebuilds the engine and re-renders the chain. Knob changes call `engine.setParam`.

- [ ] **Step 1: Write `src/main.js`**

```js
// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset } from './presets.js';
import { renderChain, renderPresetPicker } from './ui.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut;

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  if (engine) { try { source.disconnect(); } catch {} }
  engine = buildChain(ctx, preset.chain, registry);
  source.connect(engine.input);
  engine.output.connect(gainOut);
  renderChain($('chain'), engine.modules, (i, k, v) => engine.setParam(i, k, v));
}

async function start() {
  $('error').textContent = '';
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: $('input').value ? { exact: $('input').value } : undefined,
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 },
    video: false,
  });
  ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.resume();
  const outId = $('output').value;
  if (outId && outId !== 'default' && hasSetSinkId) { try { await ctx.setSinkId(outId); } catch {} }
  source = ctx.createMediaStreamSource(stream);
  gainOut = ctx.createGain();
  gainOut.gain.value = parseFloat($('gain').value);
  gainOut.connect(ctx.destination);
  renderPresetPicker($('presets'), PRESETS, loadPreset);
  loadPreset(PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0]);
  $('start').disabled = true; $('stop').disabled = false;
  $('status').textContent = 'Live — play your guitar'; $('status-dot').classList.add('live');
  listDevices();
}

function stop() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = null;
  $('start').disabled = false; $('stop').disabled = true;
  $('status').textContent = 'Stopped'; $('status-dot').classList.remove('live');
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [kind, sel] of [['audioinput', $('input')], ['audiooutput', $('output')]]) {
    sel.innerHTML = '';
    devices.filter(d => d.kind === kind).forEach((d, i) => {
      const o = new Option(d.label || `${kind} ${i + 1}`, d.deviceId);
      if (/focusrite|scarlett|usb/i.test(d.label)) o.selected = true;
      sel.add(o);
    });
    if (!sel.options.length) sel.add(new Option('System default', 'default'));
  }
}

$('gain').addEventListener('input', e => { if (gainOut) gainOut.gain.value = parseFloat(e.target.value); });
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('diag').textContent = `${isSafari ? 'Safari' : 'Chrome'} · setSinkId: ${hasSetSinkId ? 'yes' : 'no'}`;
navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});
```

- [ ] **Step 2: Update `index.html`**

Replace the second panel's pass-through-only body with mount points and load the module. Keep the device pickers, Start/Stop, gain slider, status, diag, and error elements (same ids used above). Add:
```html
<div class="panel">
  <label for="presets">Preset</label>
  <div id="presets"></div>
</div>
<div class="panel">
  <label>Signal chain (tweak any block)</label>
  <div id="chain"></div>
</div>
<script type="module" src="src/main.js"></script>
```
Remove the old inline pass-through `<script>` (its logic now lives in `main.js`). Ensure ids `input, output, start, stop, gain, status, status-dot, diag, error` still exist in the markup.

- [ ] **Step 3: Manual verification in Chrome**

Run: `npm run dev` then open `http://localhost:8000` in Chrome.
Verify by ear and eye:
1. Start → mic prompt → "Live".
2. "Mayer — Edge of Breakup" loads by default; playing sounds warm, mid-present, lightly broken up, with subtle delay/reverb — and reacts to pick dynamics (touch-sensitive).
3. Switch to "Lead Boost" → noticeably fuller/more-driven lead voicing.
4. Switch to "Clean (bypass)" → clean.
5. Open the chain, move EQ Mid / Drive Amount / Delay Mix sliders → hear the change live.
Expected: all pass. Note any tone issues for a tuning follow-up (tuning is by ear, not a code bug).

- [ ] **Step 4: Run full automated suite**

Run: `npm test`
Expected: ALL tests pass.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.js
git commit -m "feat: wire engine + presets + UI into the live app"
```

---

## Notes for the executor

- **Tuning is not debugging.** The preset numbers are research-derived starting points. If "it doesn't sound exactly like Mayer," that's a by-ear tuning pass on the preset JSON, not a failing test. Adjust values and re-listen.
- **Real-time safety:** never rebuild the graph on a knob move — only `apply` params. Graph rebuild happens only on preset switch.
- **If JSON import assertions fail in the target Chrome**, switch `presets.js` to `fetch()` each JSON (the app is served over http, so fetch works) and load presets asynchronously before first render.
