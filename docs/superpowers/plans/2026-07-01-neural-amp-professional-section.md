# Professional Neural-Amp Section — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transparent "05 Professional" browser category of 5 captured WaveNet amps that load into the existing rig, powered by the NAM core compiled to a single-thread SIMD wasm run in a normal AudioWorklet on the app's own AudioContext.

**Architecture:** Rebuild the NAM WaveNet core as plain wasm (C API: nam_load/nam_reset/nam_process) driven by a hand-written AudioWorkletProcessor on the app's single AudioContext — so the neural amp is a normal in-chain effect (pedals before/after, recording, presets) with no SharedArrayBuffer/COOP. A new `neuralamp` amp-head effect + "05 Professional" preset category expose it transparently.

**Tech Stack:** Vanilla Web Audio API; Emscripten/C++ (NAM core → wasm, single-thread, -msimd128); vitest (unit); Playwright (headless e2e).

## Global Constraints
- SINGLE-THREAD wasm: NO -pthread, NO -sAUDIO_WORKLET, NO SharedArrayBuffer → NO COOP/COEP / no coi-serviceworker.
- Build flags (exact): -Os -flto -msimd128 -DNAM_USE_INLINE_GEMM -DNAM_SAMPLE_FLOAT -DEIGEN_STACK_ALLOCATION_LIMIT=0 -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=64MB -sSTACK_SIZE=32MB.
- Exported: _malloc,_free,_nam_load,_nam_reset,_nam_process,_nam_expected_sr ; runtime: ccall,cwrap.
- Everything runs on the app's ONE existing AudioContext (src/main.js:641). No second context.
- Effect interface: create(ctx, params) → { input, output, apply }; neuralamp graph = trimGain → worklet('neural-amp-processor') → levelGain.
- 5 models: jcm, 5153, deluxe, ac10, jc (assets/neural/<name>.nam); MODELS = ['jcm','5153','deluxe','ac10','jc'].
- Worklet processor name: neural-amp-processor; messages {type:'wasm',bytes} then {type:'model',json}; passthrough until ready; nam_reset(sampleRate,128).
- Sample rate: worklet calls nam_reset(ctx.sampleRate, 128); core handles model rate internally.
- Neural presets carry a pre-measured normDb; the offline loudness path is skipped for them.
- v1 out of scope: cab-IR, user preset saving in Professional, recording changes, replacing analytic amp.

---

### Task 0: Build the plain-wasm NAM engine and de-risk running it in a bare AudioWorklet

**Goal:** Compile the NAM WaveNet core to a single-thread SIMD wasm module exposing the shared C API, then prove the one load-bearing uncertainty from §3a/§9 of the design — that this Emscripten module can be instantiated **inside an `AudioWorkletGlobalScope`** on a **normal `AudioContext`** (no COOP/COEP, no SharedArrayBuffer) and stream finite, non-silent audio from a DI file. Everything downstream (effect module, presets, UI) depends on this proof.

**Files:**
- Create: `tools/neural/nam.cpp` — the C API (adapts `poc/nam-web/bench/src/bench.cpp`)
- Create: `tools/neural/build.sh` — emscripten build with the exact contract flags → `assets/neural/nam.js` + `nam.wasm`
- Create: `tools/neural/derisk-processor.js` — hand-written `AudioWorkletProcessor` that imports the wasm factory and drives `nam_process`
- Create: `tools/neural/derisk.html` — tiny standalone spike page exposing `window.derisk`
- Create: `tools/neural/serve.mjs` — plain static server rooted at repo root (no cross-origin isolation)
- Create: `tools/neural/derisk.mjs` — Playwright headless proof (pattern from `poc/nam-web/bench/benchmark.mjs`)
- Create: `tools/neural/di-clean.wav` — DI test signal (copied from the POC's `inputs/di-clean.wav`)
- Create (built): `assets/neural/nam.js`, `assets/neural/nam.wasm`
- Create (copied): `assets/neural/jcm.nam`, `5153.nam`, `deluxe.nam`, `ac10.nam`, `jc.nam`
- Create: `tests/neural-assets.test.js` — vitest guard for the build outputs + copied models
- Modify: `package.json` scripts block (lines 5–9) + devDependencies block (lines 10–13) — add `neural:build` / `neural:derisk` scripts and the `playwright` devDependency

**Interfaces:**
- **Consumes** (NAM core, from the cloned `tone-3000/neural-amp-modeler-wasm`, exactly as `bench.cpp` uses them):
  `std::unique_ptr<nam::DSP> nam::get_dsp(nlohmann::json&)`; `nam::DSP::Reset(double sampleRate, int maxBlock)`; `nam::DSP::prewarm()`; `nam::DSP::process(NAM_SAMPLE** in, NAM_SAMPLE** out, int nframes)`; `nam::DSP::GetExpectedSampleRate()`; `nam::activations::Activation::enable_fast_tanh()`; `nlohmann::json::parse(const char*)`. `NAM_SAMPLE` is `float` under `-DNAM_SAMPLE_FLOAT`.
- **Produces** (the shared C API, exported from `nam.wasm` via `nam.js`):
  `int nam_load(const char* jsonStr)` (1 ok / 0 fail); `void nam_reset(double sampleRate, int maxBlock)`; `void nam_process(float* inPtr, float* outPtr, int n)`; `double nam_expected_sr(void)`.
  ES6 default export: `createNamModule(opts?) -> Promise<Module>` where `Module` exposes `_malloc, _free, _nam_load, _nam_reset, _nam_process, _nam_expected_sr, ccall, cwrap, HEAPF32`.
- **Produces** (assets consumed by later tasks): `assets/neural/nam.js`, `assets/neural/nam.wasm`, and `assets/neural/{jcm,5153,deluxe,ac10,jc}.nam`.
- **Produces** (de-risk only): `registerProcessor('neural-derisk-processor', …)` and `window.derisk = { start(modelUrl, diUrl), getOutputRMS()->{rms,finite}, ready() }`.

---

- [ ] **Step 1: Add the tooling dependency + scripts.** Edit `package.json` to add Playwright (browser proof) and two scripts. Replace the `scripts` and `devDependencies` blocks (current lines 5–13):

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "python3 -m http.server 8000",
    "neural:build": "bash tools/neural/build.sh",
    "neural:derisk": "node tools/neural/derisk.mjs"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "playwright": "^1.48.0"
  }
```

Then install it and the headless browser:

```bash
cd /Users/tal/Documents/guitar_web-neural && npm install && npx playwright install chromium
```

Expected output (tail): `added N packages` from npm, then Playwright prints `chromium … downloaded to …` (or `is already installed`).

- [ ] **Step 2: Write the C API (`tools/neural/nam.cpp`).** Adapts `bench.cpp`: `nam_load` parses JSON via nlohmann + `nam::get_dsp`; `nam_reset` calls `Reset` + `prewarm`; `nam_process` runs `gModel->process` on an `n`-sample block; all four guard when no model is loaded (`nam_process` falls back to a dry copy so the worklet is passthrough).

```cpp
// tools/neural/nam.cpp
// Plain-wasm C API around the NAM WaveNet core. Same DSP + build flags as the
// POC bench (poc/nam-web/bench/src/bench.cpp), but NO -sAUDIO_WORKLET / -pthread:
// single-thread + SIMD, so it runs inside a normal AudioWorkletGlobalScope on the
// app's own AudioContext (no SharedArrayBuffer, no COOP/COEP). Contract API:
//   nam_load / nam_reset / nam_process / nam_expected_sr.
#include <emscripten/emscripten.h>
#include <cmath>
#include <cstring>
#include <memory>
#include "json.hpp"
#include <NAM/dsp.h>
#include <NAM/get_dsp.h>
#include <NAM/activations.h>

static std::unique_ptr<nam::DSP> gModel;

extern "C" {

// Build the model from raw .nam JSON text. Returns 1 on success, 0 on failure.
EMSCRIPTEN_KEEPALIVE
int nam_load(const char* jsonStr) {
  try {
    nam::activations::Activation::enable_fast_tanh(); // matches the shipping engine
    auto j = nlohmann::json::parse(jsonStr);
    gModel = nam::get_dsp(j);
  } catch (...) {
    gModel = nullptr;
    return 0;
  }
  return gModel ? 1 : 0;
}

// Reset + prewarm for the AudioContext's real sample rate (like a session start).
EMSCRIPTEN_KEEPALIVE
void nam_reset(double sampleRate, int maxBlock) {
  if (!gModel) return;
  gModel->Reset(sampleRate, maxBlock);
  gModel->prewarm();
}

// Process n (<= maxBlock) samples: inPtr/outPtr are float* into the wasm heap.
// No model loaded -> dry copy (worklet passthrough), never NaN/garbage.
EMSCRIPTEN_KEEPALIVE
void nam_process(float* inPtr, float* outPtr, int n) {
  if (!gModel) {
    if (inPtr != outPtr) std::memcpy(outPtr, inPtr, (size_t)n * sizeof(float));
    return;
  }
  NAM_SAMPLE* ip = inPtr;   // NAM_SAMPLE == float under -DNAM_SAMPLE_FLOAT
  NAM_SAMPLE* op = outPtr;
  gModel->process(&ip, &op, n); // same call shape as bench.cpp
}

EMSCRIPTEN_KEEPALIVE
double nam_expected_sr(void) {
  return gModel ? gModel->GetExpectedSampleRate() : -1.0;
}

} // extern "C"
```

- [ ] **Step 3: Write the build script (`tools/neural/build.sh`).** Mirrors `poc/nam-web/bench/src/build-wasm.sh` (clones the NAM core + Eigen submodule, sources emsdk if `emcc` isn't on PATH) but compiles `nam.cpp` with the exact contract flags — **no** `-sAUDIO_WORKLET`, **no** `-pthread` — and outputs straight into `assets/neural/`.

```bash
#!/usr/bin/env bash
# Build the plain-wasm NAM engine (assets/neural/nam.{js,wasm}) from tools/neural/nam.cpp.
# Same NAM core + core flags as the POC bench (-Os -flto -msimd128 -DNAM_USE_INLINE_GEMM
# -DNAM_SAMPLE_FLOAT), MINUS the audio-worklet/pthread machinery -> single-thread + SIMD,
# runnable in a normal AudioWorkletGlobalScope with no SharedArrayBuffer / COOP-COEP.
# Requires: git, and emcc on PATH (or set EMSDK_DIR to an emsdk checkout).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"
OUT="${ROOT}/assets/neural"
WORK="${TMPDIR:-/tmp}/nam-app-build"

# 1. emscripten
if ! command -v emcc >/dev/null 2>&1; then
  if [ -n "${EMSDK_DIR:-}" ] && [ -f "${EMSDK_DIR}/emsdk_env.sh" ]; then
    # shellcheck disable=SC1091
    source "${EMSDK_DIR}/emsdk_env.sh"
  else
    echo "emcc not found. Install emsdk and put emcc on PATH, or set EMSDK_DIR." >&2
    exit 1
  fi
fi

# 2. NAM core source + Eigen (the exact DSP the POC benched)
mkdir -p "${WORK}"
if [ ! -d "${WORK}/nam-wasm/.git" ]; then
  git clone --depth 1 https://github.com/tone-3000/neural-amp-modeler-wasm.git "${WORK}/nam-wasm"
fi
cd "${WORK}/nam-wasm"
git submodule update --init Dependencies/eigen

# 3. compile the plain-wasm C API (contract flags; NO -sAUDIO_WORKLET, NO -pthread)
mkdir -p "${OUT}"
emcc "${HERE}/nam.cpp" $(find NAM -name '*.cpp') \
  -std=c++17 -Os -flto -msimd128 \
  -DNAM_USE_INLINE_GEMM -DNAM_SAMPLE_FLOAT -DEIGEN_STACK_ALLOCATION_LIMIT=0 \
  -I. -IDependencies/eigen -IDependencies/nlohmann \
  -sMODULARIZE -sEXPORT_ES6 -sENVIRONMENT=web,worker -sALLOW_MEMORY_GROWTH \
  -sINITIAL_MEMORY=64MB -sSTACK_SIZE=32MB \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_nam_load,_nam_reset,_nam_process,_nam_expected_sr \
  -sEXPORTED_RUNTIME_METHODS=ccall,cwrap \
  -o "${OUT}/nam.js"

echo "Built ${OUT}/nam.js (+ nam.wasm)"
```

- [ ] **Step 4: Build the engine.** Run the script (emsdk must be available; on this machine `emcc` is not yet on PATH, so export `EMSDK_DIR` to an emsdk checkout first).

```bash
cd /Users/tal/Documents/guitar_web-neural && EMSDK_DIR="${EMSDK_DIR:-$HOME/emsdk}" bash tools/neural/build.sh && ls -la assets/neural/nam.js assets/neural/nam.wasm
```

Expected output ends with:
```
Built /Users/tal/Documents/guitar_web-neural/assets/neural/nam.js (+ nam.wasm)
-rw-r--r--  ... assets/neural/nam.js
-rwxr-xr-x  ... assets/neural/nam.wasm
```
(`nam.wasm` should be on the order of a few hundred KB — comparable to the POC's `nam-bench.wasm`.)

- [ ] **Step 5: Copy the 5 Professional `.nam` captures into `assets/neural/`.** These are the models the presets will reference (`jcm 5153 deluxe ac10 jc`).

```bash
cd /Users/tal/Documents/guitar_web-neural && mkdir -p assets/neural && for m in jcm 5153 deluxe ac10 jc; do cp "/Users/tal/Documents/guitar_web-nam-poc/poc/nam-web/models/$m.nam" "assets/neural/$m.nam"; done && ls -la assets/neural/*.nam
```

Expected output: five lines, `jcm.nam 5153.nam deluxe.nam ac10.nam jc.nam` (sizes ~280–420 KB each).

- [ ] **Step 6: Write the de-risk worklet processor (`tools/neural/derisk-processor.js`).** A hand-written `AudioWorkletProcessor` that statically imports the wasm factory (worklet scripts are module scripts), instantiates it **once** from the posted wasm bytes (`wasmBinary`, so no `fetch`/`locateFile` is needed inside the worklet), loads one `.nam`, resets at the worklet's `sampleRate` global, and runs `nam_process` per 128-block with preallocated heap pointers (allocation-free). Passthrough until the model is live — same shape the shippable `neural-amp-processor.js` will use.

```js
// tools/neural/derisk-processor.js
// DE-RISK SPIKE (§3a / §9 of 2026-07-01-neural-amp-professional-section-design.md):
// run the plain-wasm NAM engine INSIDE an AudioWorkletGlobalScope on a NORMAL
// AudioContext. This is the one load-bearing uncertainty. Worklet module scripts
// support `import`, so we pull in the Emscripten ES6 factory directly. We hand it
// the wasm BYTES (wasmBinary) posted from the main thread -> no fetch/locateFile
// inside the worklet, no SharedArrayBuffer, no cross-origin isolation.
import createNamModule from '../../assets/neural/nam.js';

const N = 128; // Web Audio render quantum

class NeuralDeriskProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mod = null;        // Emscripten module instance
    this.ready = false;     // model loaded + heap allocated
    this.inPtr = 0;
    this.outPtr = 0;
    this._load = null;      // cwrap('nam_load')
    this._reset = null;     // cwrap('nam_reset')
    this._process = null;   // raw exported _nam_process
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  async onMessage(msg) {
    if (msg.type === 'wasm') {
      if (this.mod) return;                             // instantiate exactly once
      this.mod = await createNamModule({ wasmBinary: msg.bytes });
      this._load = this.mod.cwrap('nam_load', 'number', ['string']);
      this._reset = this.mod.cwrap('nam_reset', null, ['number', 'number']);
      this._process = this.mod._nam_process;
      this.inPtr = this.mod._malloc(N * 4);             // 128 floats in
      this.outPtr = this.mod._malloc(N * 4);            // 128 floats out
      this.port.postMessage({ type: 'wasm-ready' });
    } else if (msg.type === 'model') {
      if (!this.mod) return;
      const ok = this._load(msg.json);                 // 1 on success
      if (ok) {
        this._reset(sampleRate, N);                    // AudioWorkletGlobalScope global
        this.ready = true;
      }
      this.port.postMessage({ type: 'model-ready', ok: !!ok });
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const out = output[0];
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;
    const n = out.length;

    if (!this.ready) {                                 // PASSTHROUGH until model live
      if (inCh) out.set(inCh); else out.fill(0);
      return true;
    }

    // Re-read HEAPF32 each call: ALLOW_MEMORY_GROWTH can replace the buffer.
    const heap = this.mod.HEAPF32;
    const inBase = this.inPtr >> 2;
    const outBase = this.outPtr >> 2;
    if (inCh) heap.set(inCh, inBase); else heap.fill(0, inBase, inBase + n);
    this._process(this.inPtr, this.outPtr, n);
    for (let i = 0; i < n; i++) out[i] = heap[outBase + i];
    return true;
  }
}

registerProcessor('neural-derisk-processor', NeuralDeriskProcessor);
```

- [ ] **Step 7: Write the spike page (`tools/neural/derisk.html`).** Creates a **normal** `AudioContext`, adds the worklet module, fetches the wasm bytes + a `.nam` + the DI wav on the main thread, posts `{type:'wasm'}` then `{type:'model'}`, loops the DI through the node, and taps the wet output. Exposes `window.derisk` for the headless test.

```html
<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>NAM wasm-in-worklet de-risk</title></head>
<body>
<h1>NAM de-risk spike</h1>
<pre id="log"></pre>
<script type="module">
const log = (m) => { document.getElementById('log').textContent += m + '\n'; console.log('[derisk]', m); };
const state = { ctx: null, node: null, analyser: null, buf: null, ready: false };

async function start(modelUrl, diUrl) {
  const ctx = new AudioContext();                     // normal ctx — no COOP/COEP
  await ctx.audioWorklet.addModule('./derisk-processor.js');
  const node = new AudioWorkletNode(ctx, 'neural-derisk-processor', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
  });

  const modelReady = new Promise((resolve) => {
    node.port.onmessage = (e) => {
      log('worklet: ' + e.data.type + (e.data.ok !== undefined ? ' ok=' + e.data.ok : ''));
      if (e.data.type === 'model-ready') { state.ready = e.data.ok; resolve(e.data.ok); }
    };
  });

  const [wasmBytes, modelJson, diBuf] = await Promise.all([
    fetch('/assets/neural/nam.wasm').then((r) => r.arrayBuffer()),
    fetch(modelUrl).then((r) => { if (!r.ok) throw new Error('model ' + r.status); return r.text(); }),
    fetch(diUrl).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)),
  ]);
  node.port.postMessage({ type: 'wasm', bytes: wasmBytes }, [wasmBytes]);
  node.port.postMessage({ type: 'model', json: modelJson });
  await modelReady;

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  const buf = new Float32Array(analyser.fftSize);

  const src = ctx.createBufferSource();
  src.buffer = diBuf; src.loop = true;
  src.connect(node);
  node.connect(analyser);
  node.connect(ctx.destination);
  src.start();
  await ctx.resume();

  Object.assign(state, { ctx, node, analyser, buf });
  log('streaming ' + modelUrl.split('/').pop() + ' @ ' + ctx.sampleRate + 'Hz');
}

function getOutputRMS() {
  if (!state.analyser) return { rms: 0, finite: true };
  state.analyser.getFloatTimeDomainData(state.buf);
  let sum = 0, finite = true;
  for (const v of state.buf) { if (!Number.isFinite(v)) finite = false; sum += v * v; }
  return { rms: Math.sqrt(sum / state.buf.length), finite };
}

window.derisk = { start, getOutputRMS, ready: () => state.ready };
log('ready');
</script>
</body>
</html>
```

- [ ] **Step 8: Copy the DI signal + write the static server (`tools/neural/serve.mjs`).** Plain HTTP rooted at the **repo root** so `/assets/neural/*` and `/tools/neural/*` both resolve; deliberately **no** COOP/COEP (proving the single-thread engine needs no cross-origin isolation, unlike the POC's `serve.mjs`). First copy the DI file:

```bash
cp "/Users/tal/Documents/guitar_web-nam-poc/poc/nam-web/inputs/di-clean.wav" /Users/tal/Documents/guitar_web-neural/tools/neural/di-clean.wav && ls -la /Users/tal/Documents/guitar_web-neural/tools/neural/di-clean.wav
```

Expected: one line, `di-clean.wav` (~288 KB). Then create the server:

```js
// tools/neural/serve.mjs
// Minimal static server rooted at the repo root for the NAM de-risk spike.
// Plain HTTP: the plain-wasm engine is single-thread, so NO COOP/COEP is needed.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url)); // tools/neural -> repo root
const PORT = Number(process.env.PORT) || 8791;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.nam': 'application/json; charset=utf-8',
  '.wav': 'audio/wav',
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/tools/neural/derisk.html';
    const safe = normalize(p).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(file);
    if (info.isDirectory()) { res.writeHead(403).end('forbidden'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('not found'); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`derisk serving at http://localhost:${PORT}`));
```

- [ ] **Step 9: Write the headless de-risk proof (`tools/neural/derisk.mjs`).** Pattern lifted from `poc/nam-web/bench/benchmark.mjs`: spawn the server, launch headless Chromium, call `window.derisk.start(jcm, di)`, poll wet-output RMS across a sustained window, and gate on `finite && minRMS >= 0.002 && no pageErrors`. Exits 0 on pass, 1 on fail.

```js
// tools/neural/derisk.mjs
// DE-RISK PROOF (headless Chromium). Proves §3a: the plain-wasm NAM engine,
// instantiated INSIDE an AudioWorkletGlobalScope on a NORMAL AudioContext
// (no COOP/COEP, single-thread), streams FINITE + SUSTAINED NON-SILENT output
// from a DI file. If this passes, the shippable neural-amp-processor.js is viable.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const URL = `http://localhost:${PORT}/`;
const MODEL = '/assets/neural/jcm.nam';
const DI = '/tools/neural/di-clean.wav';
const DURATION_S = Number(process.env.DURATION_S) || 4;
const MIN_WET_RMS = 0.002;                 // ~20x the ~1e-4 noise floor (matches POC)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [join(HERE, 'serve.mjs')],
  { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('serving at') && r()));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

let pass = false, minRms = Infinity, finite = true;
try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.derisk, null, { timeout: 15000 });

  const loaded = await page.evaluate(async ({ m, d }) => {
    try { await window.derisk.start(m, d); return { ok: window.derisk.ready() }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }, { m: MODEL, d: DI });
  if (!loaded.ok) throw new Error('model did not load: ' + (loaded.error || 'nam_load returned 0'));

  const polls = 8;
  for (let i = 0; i < polls; i++) {
    await sleep((DURATION_S * 1000) / polls);
    const r = await page.evaluate(() => window.derisk.getOutputRMS());
    minRms = Math.min(minRms, r.rms);
    finite = finite && r.finite;
  }
  pass = finite && minRms >= MIN_WET_RMS && errors.length === 0;
  console.log(`finite=${finite}  minWetRMS=${minRms.toFixed(5)} (>= ${MIN_WET_RMS})  pageErrors=${errors.length}`);
  if (errors.length) console.log('PAGE ERRORS:', errors);
} catch (e) {
  console.error('DERISK ERROR:', e.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(pass
  ? '✅ DE-RISK PASS — NAM wasm runs in a normal AudioWorklet, finite & non-silent.'
  : '❌ DE-RISK FAIL — see above.');
process.exit(pass ? 0 : 1);
```

- [ ] **Step 10: Write the vitest guard (`tests/neural-assets.test.js`).** Deterministic, browserless CI net: asserts the build emitted a valid wasm binary + an ES6 factory exposing the exact C-API symbols, and that all five models are parseable NAM WaveNet JSON. (The functional wasm-in-worklet behavior is proven by `derisk.mjs`, which needs a real browser.)

```js
// tests/neural-assets.test.js
// Guards the built neural-amp engine artifacts + copied models (no browser).
// Functional wasm-in-worklet proof lives in tools/neural/derisk.mjs (Playwright).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asset = (p) => fileURLToPath(new URL('../assets/neural/' + p, import.meta.url));
const MODELS = ['jcm', '5153', 'deluxe', 'ac10', 'jc'];

describe('neural assets', () => {
  it('emitted nam.js + nam.wasm', () => {
    expect(existsSync(asset('nam.js'))).toBe(true);
    expect(existsSync(asset('nam.wasm'))).toBe(true);
  });

  it('nam.wasm starts with the wasm magic (\\0asm)', () => {
    const b = readFileSync(asset('nam.wasm'));
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('nam.js is an ES6 factory exposing the C API + runtime methods', () => {
    const js = readFileSync(asset('nam.js'), 'utf8');
    expect(js).toMatch(/export default/);
    for (const fn of ['_nam_load', '_nam_reset', '_nam_process', '_nam_expected_sr', '_malloc', '_free'])
      expect(js).toContain(fn);
    expect(js).toMatch(/ccall|cwrap/);
  });

  it('ships all 5 Professional models as parseable NAM WaveNet JSON', () => {
    for (const m of MODELS) {
      const j = JSON.parse(readFileSync(asset(m + '.nam'), 'utf8'));
      expect(j).toHaveProperty('architecture', 'WaveNet');
      expect(j).toHaveProperty('weights');
    }
  });
});
```

- [ ] **Step 11: Run both test layers and confirm the de-risk passes.**

```bash
cd /Users/tal/Documents/guitar_web-neural && npx vitest run tests/neural-assets.test.js && npm run neural:derisk
```

Expected output:
```
 ✓ tests/neural-assets.test.js (4 tests) ...
 Test Files  1 passed (1)
...
derisk serving at http://localhost:8791
worklet: wasm-ready
worklet: model-ready ok=true
finite=true  minWetRMS=0.0XXXX (>= 0.002)  pageErrors=0
✅ DE-RISK PASS — NAM wasm runs in a normal AudioWorklet, finite & non-silent.
```
This green de-risk is the gate that unblocks every downstream task. If it fails, stop and take a §3a fallback (POC separate-view engine, or the hand-rolled LSTM) before building any UI.

- [ ] **Step 12: Commit.**

```bash
cd /Users/tal/Documents/guitar_web-neural && git add tools/neural assets/neural tests/neural-assets.test.js package.json package-lock.json && git commit -m "$(cat <<'EOF'
feat(neural): plain-wasm NAM engine + wasm-in-worklet de-risk proof

Build tools/neural/nam.cpp (nam_load/nam_reset/nam_process/nam_expected_sr)
to assets/neural/nam.{js,wasm} via emscripten (single-thread, SIMD, no
-sAUDIO_WORKLET/-pthread). Prove the load-bearing risk (Emscripten module
inside a normal AudioWorkletGlobalScope, no COOP/COEP) with a headless
Playwright test asserting finite, sustained non-silent output from a DI file.
Copy the 5 Professional .nam models into assets/neural/.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected output: one commit summarizing the created files (`tools/neural/*`, `assets/neural/*`, `tests/neural-assets.test.js`, `package.json`).

---

I have everything I need. Here is the task section.

---

### Task 1: Neural-amp AudioWorklet processor (wasm host + dry passthrough)

Implement the plain (single-thread) `AudioWorkletProcessor` that hosts the NAM WaveNet wasm core on the app's own `AudioContext`. It instantiates the emscripten module once from posted `nam.wasm` bytes (no `fetch` in `AudioWorkletGlobalScope`), loads a `.nam` model on request, and runs allocation-free `nam_process` per 128-sample block — falling back to dry passthrough until a model is ready. The real in-browser instantiation is de-risked/covered end-to-end by the Playwright run in Task 7; this task proves the message protocol, passthrough, and heap round-trip with vitest against a mocked emscripten module.

**Files:**
- Create: `src/effects/worklets/neural-amp-processor.js` — the processor.
- Create: `assets/neural/nam.js` — placeholder emscripten ES6 factory so the worklet's static `import` resolves and the app runs (dry) before the engine is built; **replaced by the real `-sMODULARIZE -sEXPORT_ES6` build in Task 0**.
- Create: `tests/neural-amp-processor.test.js` — vitest unit test (mocks `assets/neural/nam.js`).
- Modify: `src/effects/worklets/index.js` — add the processor URL to `URLS` (lines 4-7).

**Interfaces:**
- Consumes — `createNamModule` (default export of `assets/neural/nam.js`): `(opts?: { wasmBinary?: ArrayBuffer }) => Promise<Module>`, where `Module` has `_malloc(bytes:number):number`, `_free(ptr:number):void`, `HEAPF32:Float32Array`, `cwrap(name:string, ret:string|null, argTypes:string[]):Function`.
- Consumes — C API via `cwrap`: `nam_load(json:string) -> number` (1 ok / 0 fail), `nam_reset(sampleRate:number, maxBlock:number) -> void`, `nam_process(inPtr:number, outPtr:number, n:number) -> void`.
- Consumes — `AudioWorkletGlobalScope` globals `sampleRate:number`, `AudioWorkletProcessor`, `registerProcessor`; port messages IN `{type:'wasm', bytes:ArrayBuffer}` and `{type:'model', json:string}`.
- Produces — `registerProcessor('neural-amp-processor', NeuralAmpProcessor)` (1 input / 1 output, mono, 128-sample `process`); port messages OUT `{type:'ready'}` (after `nam_load` succeeds) and `{type:'error', error:string}`; a `URLS` entry so `loadWorklets(ctx)` (`src/effects/worklets/index.js:11`) registers it on every context.

---

- [ ] **Step 1: Write the failing unit test.**

Create `tests/neural-amp-processor.test.js`:

```js
// tests/neural-amp-processor.test.js — unit-tests the neural-amp worklet processor
// by shimming the AudioWorkletGlobalScope (AudioWorkletProcessor, registerProcessor,
// sampleRate) and MOCKING the emscripten glue (assets/neural/nam.js) with a fake
// module backed by a real WebAssembly.Memory, so the in->heap->process->heap->out
// round-trip is exercised without the compiled wasm. The real in-browser
// instantiation is covered end-to-end by Task 7's Playwright run.
import { describe, it, expect, beforeAll, vi } from 'vitest';

// Fake emscripten module: real HEAPF32, bump malloc, and a nam_process that doubles
// each sample so the heap copy path is deterministically observable.
vi.mock('../assets/neural/nam.js', () => ({
  default: async () => {
    const mem = new WebAssembly.Memory({ initial: 8 });
    let brk = 16;
    const mod = {
      HEAPF32: new Float32Array(mem.buffer),
      _malloc(bytes) { const p = brk; brk += (bytes + 15) & ~15; return p; },
      _free() {},
      cwrap(name) {
        if (name === 'nam_load') return (json) => (typeof json === 'string' && json.length ? 1 : 0);
        if (name === 'nam_reset') return () => {};
        if (name === 'nam_process') return (inPtr, outPtr, n) => {
          const h = mod.HEAPF32, i = inPtr >> 2, o = outPtr >> 2;
          for (let k = 0; k < n; k++) h[o + k] = h[i + k] * 2;
        };
        return () => {};
      },
    };
    return mod;
  },
}));

const registered = {};

beforeAll(async () => {
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (name, ctor) => { registered[name] = ctor; };
  await import('../src/effects/worklets/neural-amp-processor.js');
});

const block = (arr) => [[Float32Array.from(arr)]];       // one input, one channel
const out = (n) => [[new Float32Array(n)]];
const ramp = (n) => Array.from({ length: n }, (_, i) => (i + 1) / n);

describe('neural-amp-processor', () => {
  it('registers under its processor name', () => {
    expect(registered['neural-amp-processor']).toBeTypeOf('function');
  });

  it('is a dry passthrough before a model is loaded', () => {
    const p = new registered['neural-amp-processor']();
    const input = ramp(128);
    const o = out(128);
    p.process(block(input), o, {});
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBe(input[i]);
  });

  it('outputs silence when there is no connected input', () => {
    const p = new registered['neural-amp-processor']();
    const o = out(128);
    p.process([[]], o, {});                               // input with no channels
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBe(0);
  });

  it('instantiates the wasm once and runs nam_process after a model is posted', async () => {
    const p = new registered['neural-amp-processor']();
    await p.port.onmessage({ data: { type: 'wasm', bytes: new ArrayBuffer(8) } });
    await p.port.onmessage({ data: { type: 'model', json: '{"fake":true}' } });

    const input = ramp(128);
    const o = out(128);
    p.process(block(input), o, {});
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBeCloseTo(input[i] * 2, 6);
  });

  it('applies a model that arrives before the wasm bytes (queued)', async () => {
    const p = new registered['neural-amp-processor']();
    await p.port.onmessage({ data: { type: 'model', json: '{"fake":true}' } }); // queued
    const o0 = out(128);
    p.process(block(ramp(128)), o0, {});                 // still dry — wasm not in yet
    expect(o0[0][0][0]).toBeCloseTo(1 / 128, 6);

    await p.port.onmessage({ data: { type: 'wasm', bytes: new ArrayBuffer(8) } });
    const input = ramp(128);
    const o = out(128);
    p.process(block(input), o, {});
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBeCloseTo(input[i] * 2, 6);
  });

  it('stays dry when nam_load fails (empty model json)', async () => {
    const p = new registered['neural-amp-processor']();
    await p.port.onmessage({ data: { type: 'wasm', bytes: new ArrayBuffer(8) } });
    await p.port.onmessage({ data: { type: 'model', json: '' } }); // fake nam_load -> 0
    const input = ramp(128);
    const o = out(128);
    p.process(block(input), o, {});
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBe(input[i]); // passthrough
  });
});
```

Run it and confirm it fails because the processor module does not exist yet:

```
$ npx vitest run tests/neural-amp-processor.test.js
 FAIL  tests/neural-amp-processor.test.js
Error: Failed to load url ../src/effects/worklets/neural-amp-processor.js (resolved id: .../src/effects/worklets/neural-amp-processor.js). Does the file exist?
 Test Files  1 failed (1)
```

- [ ] **Step 2: Create the placeholder emscripten factory so the static import resolves.**

Create `assets/neural/nam.js`:

```js
// assets/neural/nam.js — PLACEHOLDER. Replaced by the real emscripten build in
// Task 6 (tools/neural -> nam.js + nam.wasm, -sMODULARIZE -sEXPORT_ES6). It exists
// so the worklet's static `import createNamModule from './.../nam.js'` resolves and
// the app runs (dry passthrough) before the engine is compiled. Its nam_load always
// returns 0, so the neural amp stays in passthrough until the real module ships.
// Unit tests mock this module (see tests/neural-amp-processor.test.js).
export default async function createNamModule() {
  const mem = new WebAssembly.Memory({ initial: 4 }); // 256 KB, enough for two 128-sample blocks
  let brk = 16;
  const mod = {
    HEAPF32: new Float32Array(mem.buffer),
    _malloc(bytes) { const p = brk; brk += (bytes + 15) & ~15; return p; },
    _free() {},
    cwrap(name) {
      if (name === 'nam_load') return () => 0; // never ready -> passthrough
      return () => {};
    },
  };
  return mod;
}
```

- [ ] **Step 3: Implement the processor (makes the test pass).**

Create `src/effects/worklets/neural-amp-processor.js`:

```js
// src/effects/worklets/neural-amp-processor.js — NAM WaveNet core (compiled to a
// single-thread SIMD wasm module) run as a plain AudioWorkletProcessor on the app's
// own AudioContext. The main thread fetches nam.wasm + a model's .nam JSON and posts
// them in; the emscripten ES6 glue (nam.js) is statically imported here and
// instantiated from the posted bytes (fetch is unavailable in AudioWorkletGlobalScope,
// so we pass `wasmBinary`). Runs dry passthrough until a model is loaded. Steady state
// is allocation-free (preallocated heap pointers + cached heap views). Monomorphic,
// mirrors pitchshift-processor.js. Static imports in AudioWorklet modules are supported
// in Chromium, the app's target; end-to-end coverage is Task 7.
import createNamModule from '../../../assets/neural/nam.js';

class NeuralAmpProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mod = null;            // emscripten Module instance
    this.ready = false;         // true once nam_load succeeded
    this.instantiating = false; // guards single instantiation
    this.pendingModel = null;   // model json that arrived before the wasm bytes
    this.cap = 128;             // max block == render quantum
    this.inPtr = 0;
    this.outPtr = 0;
    this.namLoad = null;
    this.namReset = null;
    this.namProcess = null;
    this.heapBuf = null;        // ArrayBuffer backing the cached heap views
    this.inView = null;         // Float32Array view over [inPtr, inPtr+cap)
    this.outView = null;        // Float32Array view over [outPtr, outPtr+cap)
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  async onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'wasm') {
      if (this.mod || this.instantiating) return;        // instantiate exactly once
      this.instantiating = true;
      try {
        const mod = await createNamModule({ wasmBinary: msg.bytes });
        this.inPtr = mod._malloc(this.cap * 4);
        this.outPtr = mod._malloc(this.cap * 4);
        this.namLoad = mod.cwrap('nam_load', 'number', ['string']);
        this.namReset = mod.cwrap('nam_reset', null, ['number', 'number']);
        this.namProcess = mod.cwrap('nam_process', null, ['number', 'number', 'number']);
        this.refreshViews(mod.HEAPF32);
        this.mod = mod;
        if (this.pendingModel !== null) {                // a model was queued pre-wasm
          const json = this.pendingModel;
          this.pendingModel = null;
          this.loadModel(json);
        }
      } catch (err) {
        this.port.postMessage({ type: 'error', error: String((err && err.message) || err) });
      } finally {
        this.instantiating = false;
      }
    } else if (msg.type === 'model') {
      if (!this.mod) { this.pendingModel = msg.json; return; } // apply once wasm is in
      this.loadModel(msg.json);
    }
  }

  loadModel(json) {
    this.ready = false;                        // dry while (re)loading
    const ok = this.namLoad(json);
    if (ok) {
      this.namReset(sampleRate, this.cap);     // sampleRate = AudioWorkletGlobalScope global
      this.ready = true;
      this.port.postMessage({ type: 'ready' });
    } else {
      this.port.postMessage({ type: 'error', error: 'nam_load failed' });
    }
  }

  refreshViews(heap) {
    this.heapBuf = heap.buffer;
    this.inView = heap.subarray(this.inPtr >> 2, (this.inPtr >> 2) + this.cap);
    this.outView = heap.subarray(this.outPtr >> 2, (this.outPtr >> 2) + this.cap);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const out = output[0];
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;
    const n = out.length;

    if (!this.ready) {                         // dry passthrough until model is ready
      if (inCh) out.set(inCh); else out.fill(0);
      return true;
    }

    const heap = this.mod.HEAPF32;
    if (heap.buffer !== this.heapBuf) this.refreshViews(heap); // wasm memory grew -> re-view
    const inView = this.inView, outView = this.outView;

    if (n === this.cap) {                       // common path: allocation-free block copy
      if (inCh) inView.set(inCh); else inView.fill(0, 0, n);
      this.namProcess(this.inPtr, this.outPtr, n);
      out.set(outView);
    } else {                                    // defensive: partial quantum
      if (inCh) { for (let i = 0; i < n; i++) inView[i] = inCh[i]; }
      else { for (let i = 0; i < n; i++) inView[i] = 0; }
      this.namProcess(this.inPtr, this.outPtr, n);
      for (let i = 0; i < n; i++) out[i] = outView[i];
    }
    return true;
  }
}

registerProcessor('neural-amp-processor', NeuralAmpProcessor);
```

Run the unit test — it now passes:

```
$ npx vitest run tests/neural-amp-processor.test.js

 RUN  v2.1.0

 ✓ tests/neural-amp-processor.test.js (6)

 Test Files  1 passed (1)
      Tests  6 passed (6)
```

- [ ] **Step 4: Register the worklet URL so `loadWorklets(ctx)` installs it on every context.**

Edit `src/effects/worklets/index.js` — add the neural processor to `URLS` (lines 4-7):

```js
const URLS = [
  new URL('./pitchshift-processor.js', import.meta.url).href,
  new URL('./looper-processor.js', import.meta.url).href,
  new URL('./neural-amp-processor.js', import.meta.url).href,
];
```

Verify the entry is present:

```
$ grep -n "neural-amp-processor" src/effects/worklets/index.js
7:  new URL('./neural-amp-processor.js', import.meta.url).href,
```

Run the whole worklet suite to confirm nothing regressed:

```
$ npx vitest run tests/worklet-processors.test.js tests/neural-amp-processor.test.js

 Test Files  2 passed (2)
```

- [ ] **Step 5: Commit.**

```
$ git add src/effects/worklets/neural-amp-processor.js src/effects/worklets/index.js assets/neural/nam.js tests/neural-amp-processor.test.js
$ git commit -m "$(cat <<'EOF'
feat(neural): NAM wasm AudioWorklet processor with dry passthrough

Add neural-amp-processor: instantiates the NAM wasm core once from posted
nam.wasm bytes, loads a .nam model (nam_load + nam_reset at ctx sampleRate),
and runs allocation-free nam_process per 128-block, dry passthrough until
ready. Register its URL in worklets/index.js. Placeholder assets/neural/nam.js
resolves the static import until the real emscripten build (Task 6). Unit test
mocks the emscripten module and covers registration, passthrough, queued-model,
load-failure, and the heap round-trip.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected:

```
[wow-backgrounds <hash>] feat(neural): NAM wasm AudioWorklet processor with dry passthrough
 4 files changed, ...
```

---

I have everything I need. Here is the task section.

---

### Task 2: Implement `src/effects/neuralamp.js` (amp-head effect: trimGain → neural-amp worklet → levelGain)

Build the neural-amp chain effect module exactly per the shared contract: `schema` + `MODELS` + `create(ctx, params)` that constructs `trimGain → AudioWorkletNode('neural-amp-processor') → levelGain`, fetches the wasm (once, module-cached) and the selected `.nam` model, posts `{type:'wasm',bytes}` then `{type:'model',json}` to the worklet, and returns `{ input, output, apply }`. `apply` sets the trim/level gains and reposts a new `.nam` when the model index changes. This is a pure unit-testable module: the worklet processor and asset files are produced by other tasks, and the vitest spec stubs `AudioWorkletNode` + `fetch`, so this task has no runtime dependency on them.

**Files:**
- Create: `/Users/tal/Documents/guitar_web-neural/src/effects/neuralamp.js`
- Create: `/Users/tal/Documents/guitar_web-neural/tests/neuralamp.test.js`
- (No modifies in this task — registry wiring in `src/effects/index.js:29-34`, worklet URL in `src/effects/worklets/index.js:4-7`, and `AMP_TYPES` in `src/chain-state.js:3` are handled by their own tasks.)

**Interfaces:**
- Consumes: `globalThis.AudioWorkletNode` — `new AudioWorkletNode(ctx, 'neural-amp-processor', options)` (Web Audio); `globalThis.fetch(url) → Promise<Response>` for `assets/neural/nam.wasm` (`.arrayBuffer()`) and `assets/neural/<MODELS[i]>.nam` (`.text()`); worklet processor registered under the name `'neural-amp-processor'` (produced by the worklet task; not needed for this unit test).
- Produces: `export const schema` (`type:'neuralamp'`, params `model`/`trim`/`level`); `export const MODELS = ['jcm','5153','deluxe','ac10','jc']`; `export function create(ctx, params) → { input: GainNode, output: GainNode, apply(params): void }` where `input` is `trimGain`, `output` is `levelGain`, `input !== output`. Port messages produced: `{type:'wasm', bytes:ArrayBuffer}` then `{type:'model', json:string}` (contract for `neural-amp-processor.js`).

---

- [ ] **Step 1: Write the failing vitest spec (RED).**

Create `/Users/tal/Documents/guitar_web-neural/tests/neuralamp.test.js`. It stubs `AudioWorkletNode` (recording port messages + participating in `FakeAudioContext` connection tracking) and `fetch` (returns 8 wasm bytes for `*.nam.wasm`, and JSON encoding the requested model name for `*.nam`), then asserts the full contract.

```js
// tests/neuralamp.test.js — unit spec for the neuralamp amp-head effect.
// Stubs AudioWorkletNode + fetch so the module can be exercised in jsdom with no
// real worklet/wasm. Verifies the schema/MODELS exports, the trimGain→worklet→
// levelGain graph, the 0..10→gain (unity at 5) mapping, the initial wasm+model
// posts, and reposting on model change.
import { describe, it, expect, beforeAll } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';
import { schema, MODELS, create } from '../src/effects/neuralamp.js';

// A worklet node that plugs into FakeAudioContext's connection graph and records
// every port.postMessage. Registers itself on ctx.workletNodes for inspection.
class FakeWorkletNode {
  constructor(ctx, name, opts) {
    this.ctx = ctx; this.name = name; this.opts = opts;
    this.id = ctx._nextId++; this.kind = 'worklet';
    this.messages = [];
    this.port = { postMessage: (m) => this.messages.push(m) };
    (ctx.workletNodes ||= []).push(this);
  }
  connect(node) {
    this.ctx.connections.push({ from: this.id, to: node.id, fromKind: this.kind, toKind: node.kind });
    return node;
  }
  disconnect() {}
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  globalThis.AudioWorkletNode = FakeWorkletNode;
  globalThis.fetch = (url) => {
    const s = String(url);
    if (s.endsWith('.wasm')) {
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    const name = s.split('/').pop().replace(/\.nam$/, ''); // e.g. "5153"
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ model: name })) });
  };
});

describe('neuralamp effect', () => {
  it('exposes the neuralamp schema and the 5 model ids', () => {
    expect(schema.type).toBe('neuralamp');
    expect(schema.label).toBe('Neural Amp');
    expect(schema.params.map((p) => p.key)).toEqual(['model', 'trim', 'level']);
    const model = schema.params.find((p) => p.key === 'model');
    expect([model.min, model.max, model.default, model.step]).toEqual([0, 4, 0, 1]);
    expect(MODELS).toEqual(['jcm', '5153', 'deluxe', 'ac10', 'jc']);
  });

  it('create() returns {input, output, apply} with distinct gain nodes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    expect(typeof fx.apply).toBe('function');
    expect(fx.input).toBeTruthy();
    expect(fx.output).toBeTruthy();
    expect(fx.input).not.toBe(fx.output);
    expect(fx.input.kind).toBe('gain');   // trimGain
    expect(fx.output.kind).toBe('gain');  // levelGain
  });

  it('wires trimGain → worklet → levelGain and posts wasm + initial model', async () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    const node = ctx.workletNodes[0];
    expect(node.name).toBe('neural-amp-processor');
    expect(ctx.connections).toContainEqual(
      expect.objectContaining({ from: fx.input.id, to: node.id }));
    expect(ctx.connections).toContainEqual(
      expect.objectContaining({ from: node.id, to: fx.output.id }));
    await flush();
    expect(node.messages.some((m) => m.type === 'wasm')).toBe(true);
    const modelMsgs = node.messages.filter((m) => m.type === 'model');
    expect(modelMsgs).toHaveLength(1);
    expect(JSON.parse(modelMsgs[0].json).model).toBe('jcm'); // MODELS[0]
  });

  it('maps trim/level 0..10 to gain centred on unity at 5', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    expect(fx.input.gain.value).toBeCloseTo(1, 6);   // trim 5 → unity
    expect(fx.output.gain.value).toBeCloseTo(1, 6);  // level 5 → unity
    fx.apply({ model: 0, trim: 10, level: 0 });
    expect(fx.input.gain.value).toBeCloseTo(Math.pow(10, 0.5), 6);   // ≈3.1623
    expect(fx.output.gain.value).toBeCloseTo(Math.pow(10, -0.5), 6); // ≈0.3162
  });

  it('reposts a new .nam on model change and skips a repost when unchanged', async () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    await flush();
    const node = ctx.workletNodes[0];
    const modelMsgs = () => node.messages.filter((m) => m.type === 'model');
    expect(modelMsgs()).toHaveLength(1);

    fx.apply({ model: 1, trim: 5, level: 5 }); // 0 → 1
    await flush();
    expect(modelMsgs()).toHaveLength(2);
    expect(JSON.parse(modelMsgs()[1].json).model).toBe('5153'); // MODELS[1]

    fx.apply({ model: 1, trim: 6, level: 4 }); // model unchanged
    await flush();
    expect(modelMsgs()).toHaveLength(2); // no extra model post
  });
});
```

Run it and confirm it fails because the module does not exist yet:

```bash
cd /Users/tal/Documents/guitar_web-neural && npx vitest run tests/neuralamp.test.js
```

Expected output (RED — import cannot resolve the not-yet-created module):

```
FAIL  tests/neuralamp.test.js [ tests/neuralamp.test.js ]
Error: Failed to load url ../src/effects/neuralamp.js (resolved id: .../src/effects/neuralamp.js). Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 2: Implement `src/effects/neuralamp.js` (GREEN).**

Create `/Users/tal/Documents/guitar_web-neural/src/effects/neuralamp.js` with the complete module. The wasm bytes are fetched through one module-level cached promise (shared across all nodes/contexts) and posted per node without transfer so the cached buffer is never detached; the model `.nam` is fetched per node and re-fetched only when the model index changes.

```js
// src/effects/neuralamp.js — Neural Amp (NAM WaveNet core running as a plain
// single-thread WASM AudioWorklet on the app's own AudioContext).
//
// An amp-head effect. Graph:  input = trimGain → AudioWorkletNode('neural-amp-processor')
//                             → output = levelGain
// The worklet stays in dry passthrough until it has received both the wasm module
// bytes and a .nam model JSON via port.postMessage. Switching amps = a fresh
// preset load builds a fresh node with the new model (no in-place swap race),
// but apply() also supports live model changes by reposting the new .nam.

export const schema = {
  type: 'neuralamp',
  label: 'Neural Amp',
  params: [
    { key: 'model', label: 'Amp',   min: 0, max: 4,  default: 0, step: 1 },
    { key: 'trim',  label: 'Trim',  min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

// Model index → assets/neural/<name>.nam (WaveNet captures from the POC).
export const MODELS = ['jcm', '5153', 'deluxe', 'ac10', 'jc'];

// The compiled engine's wasm bytes are identical for every node and every
// context, so fetch them exactly once and share the promise across all create()
// calls. Posted (structured-cloned) to each worklet — never transferred, so the
// cached ArrayBuffer stays intact for later nodes.
let wasmBytesPromise = null;
function loadWasmBytes() {
  if (!wasmBytesPromise) {
    wasmBytesPromise = fetch(new URL('../../assets/neural/nam.wasm', import.meta.url))
      .then((r) => r.arrayBuffer());
  }
  return wasmBytesPromise;
}

function fetchModelJson(index) {
  const name = MODELS[index] ?? MODELS[0];
  return fetch(new URL(`../../assets/neural/${name}.nam`, import.meta.url)).then((r) => r.text());
}

// 0..10 → linear gain, centred so 5 = unity: 10 ** ((v - 5) * 0.1).
function gainFor(v) { return Math.pow(10, ((v ?? 5) - 5) * 0.1); }

export function create(ctx, params) {
  const trimGain = ctx.createGain();
  const levelGain = ctx.createGain();
  const node = new AudioWorkletNode(ctx, 'neural-amp-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    outputChannelCount: [1],
  });

  trimGain.connect(node);
  node.connect(levelGain);

  let currentModel = Math.round(params.model ?? 0);

  // Hand the worklet the engine once, then the initial model. Until the model
  // lands the worklet runs dry passthrough.
  loadWasmBytes().then((bytes) => node.port.postMessage({ type: 'wasm', bytes }));
  fetchModelJson(currentModel).then((json) => node.port.postMessage({ type: 'model', json }));

  const apply = (p) => {
    trimGain.gain.value = gainFor(p.trim);
    levelGain.gain.value = gainFor(p.level);
    const m = Math.round(p.model ?? 0);
    if (m !== currentModel) {
      currentModel = m;
      fetchModelJson(m).then((json) => node.port.postMessage({ type: 'model', json }));
    }
  };
  apply(params);

  return { input: trimGain, output: levelGain, apply };
}
```

Run the spec and confirm all cases pass:

```bash
cd /Users/tal/Documents/guitar_web-neural && npx vitest run tests/neuralamp.test.js
```

Expected output (GREEN):

```
 ✓ tests/neuralamp.test.js (5 tests)
   ✓ neuralamp effect > exposes the neuralamp schema and the 5 model ids
   ✓ neuralamp effect > create() returns {input, output, apply} with distinct gain nodes
   ✓ neuralamp effect > wires trimGain → worklet → levelGain and posts wasm + initial model
   ✓ neuralamp effect > maps trim/level 0..10 to gain centred on unity at 5
   ✓ neuralamp effect > reposts a new .nam on model change and skips a repost when unchanged

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

- [ ] **Step 3: Run the full suite to confirm no regressions.**

The new module is standalone (not yet imported by `src/effects/index.js`), so the existing suite must remain green.

```bash
cd /Users/tal/Documents/guitar_web-neural && npm test
```

Expected output (all prior test files plus the new one pass; counts shown are illustrative of "all green"):

```
 Test Files  44 passed (44)
      Tests  <all> passed
```

- [ ] **Step 4: Commit.**

```bash
cd /Users/tal/Documents/guitar_web-neural && git add src/effects/neuralamp.js tests/neuralamp.test.js && git commit -m "feat(neuralamp): amp-head effect module (trim→worklet→level) + unit spec

Adds src/effects/neuralamp.js per the neural-amp contract: schema + MODELS
(jcm/5153/deluxe/ac10/jc) + create() building trimGain → AudioWorkletNode
('neural-amp-processor') → levelGain, fetching the module-cached nam.wasm and
the selected .nam, posting {type:'wasm'} then {type:'model'}, with apply()
setting 0..10→gain (unity at 5) and reposting the .nam on model change.
vitest spec stubs AudioWorkletNode + fetch to verify the graph, gain mapping,
and repost behaviour.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Register `neuralamp` in the effects registry and mark it a locked amp-head type

Wire the (Task 2) `src/effects/neuralamp.js` module into the effect `registry` and make `chain-state` treat `neuralamp` as a locked amp-head module (same class as `drive`/`eq`/`cabinet`), so a Professional preset renders in the amp head and can't be dragged into a pedal slot. Purely additive: one import + one array entry in `src/effects/index.js`, and one string added to the `AMP_TYPES` set in `src/chain-state.js`.

**Files:**
- Create: `/Users/tal/Documents/guitar_web-neural/tests/neuralamp-registry.test.js`
- Modify: `/Users/tal/Documents/guitar_web-neural/src/effects/index.js` — add import after existing `rotary` import (currently line 27); add `neuralamp` to the `mods` array (currently line 33)
- Modify: `/Users/tal/Documents/guitar_web-neural/src/chain-state.js` — extend `AMP_TYPES` set (currently line 3)

**Interfaces:**
- Consumes (from `src/effects/neuralamp.js`, created in Task 2):
  - `export const schema` where `schema.type === 'neuralamp'`, `schema.label === 'Neural Amp'`, `schema.params` = `[{key:'model',…},{key:'trim',…},{key:'level',…}]`
  - `export function create(ctx, params) -> { input, output, apply }`
  - `export const MODELS = ['jcm','5153','deluxe','ac10','jc']`
  - Requirement: `neuralamp.js` must have **no top-level fetch/side effects** (its wasm fetch is a lazily-memoized module-level promise inside `create`), so importing it under jsdom is safe.
- Produces:
  - `registry['neuralamp'] === { schema, create }` (from `src/effects/index.js`, via `Object.fromEntries(mods.map((m) => [m.schema.type, { schema: m.schema, create: m.create }]))`)
  - `AMP_TYPES.has('neuralamp') === true` in `src/chain-state.js`, which drives `fromPreset` (`locked: AMP_TYPES.has(e.type)`), `ampBounds`, and the `move` clamp.

---

- [ ] **Step 1: Write the failing test (red).** Create `/Users/tal/Documents/guitar_web-neural/tests/neuralamp-registry.test.js`. It fails now because `registry` has no `neuralamp` key and `AMP_TYPES` does not include `'neuralamp'` (so `fromPreset` won't lock it and `ampBounds`/`move` won't fence it).

```js
// tests/neuralamp-registry.test.js — Task 3: neuralamp is registered as an
// effect AND treated as a locked amp-head type by the pure chain model.
import { describe, it, expect } from 'vitest';
import { registry } from '../src/effects/index.js';
import { MODELS } from '../src/effects/neuralamp.js';
import { fromPreset, ampBounds, move } from '../src/chain-state.js';

describe('neuralamp registration (src/effects/index.js)', () => {
  it('exposes registry.neuralamp with a schema and a create function', () => {
    const def = registry['neuralamp'];
    expect(def).toBeTruthy();
    expect(def.schema.type).toBe('neuralamp');
    expect(def.schema.label).toBe('Neural Amp');
    expect(typeof def.create).toBe('function');
  });
  it('schema declares the model/trim/level params from the contract', () => {
    const keys = registry['neuralamp'].schema.params.map((p) => p.key);
    expect(keys).toEqual(['model', 'trim', 'level']);
  });
  it('ships 5 model ids that map to assets/neural/<name>.nam', () => {
    expect(MODELS).toEqual(['jcm', '5153', 'deluxe', 'ac10', 'jc']);
  });
});

describe('neuralamp is a locked amp-head type (src/chain-state.js AMP_TYPES)', () => {
  // pedal -> neuralamp(amp head) -> cabinet(amp) -> pedal
  const PRO = [
    { type: 'boost', params: {} },
    { type: 'neuralamp', params: { model: 0, trim: 5, level: 5 } },
    { type: 'cabinet', params: {} },
    { type: 'delay', params: {} },
  ];
  const build = () => fromPreset(PRO, 1);

  it('fromPreset locks the neuralamp unit', () => {
    const { chain } = build();
    expect(chain.map((u) => u.locked)).toEqual([false, true, true, false]);
  });
  it('ampBounds includes neuralamp in the contiguous amp block', () => {
    const { chain } = build();
    expect(ampBounds(chain)).toEqual({ start: 1, end: 2 });
  });
  it('move refuses to relocate the locked neuralamp head', () => {
    const { chain } = build();
    expect(move(chain, 2, 0).map((u) => u.type)).toEqual(chain.map((u) => u.type));
  });
  it('move clamps a pedal dropped inside the amp block to just before it', () => {
    const { chain } = build();
    const moved = move(chain, 4, 2); // delay dropped inside the amp block (index 2)
    // tie-break lands it at the block start (index 1), never between neuralamp & cabinet
    expect(moved.map((u) => u.type)).toEqual(['boost', 'delay', 'neuralamp', 'cabinet']);
  });
});
```

Run it and confirm it is red:

```
npx vitest run tests/neuralamp-registry.test.js
```

Expected output (fails — `registry.neuralamp` is undefined and `neuralamp` isn't locked):

```
 FAIL  tests/neuralamp-registry.test.js > neuralamp registration (src/effects/index.js) > exposes registry.neuralamp with a schema and a create function
AssertionError: expected undefined to be truthy
 FAIL  tests/neuralamp-registry.test.js > neuralamp is a locked amp-head type (src/chain-state.js AMP_TYPES) > fromPreset locks the neuralamp unit
AssertionError: expected [ false, false, true, false ] to deeply equal [ false, true, true, false ]

 Test Files  1 failed (1)
      Tests  ... failed
```

- [ ] **Step 2: Register `neuralamp` in `src/effects/index.js` (green part 1).** Add the import immediately after the `rotary` import (after current line 27) and append `neuralamp` to the `mods` array (current line 33). The final regions read exactly:

```js
import * as autopan from './autopan.js';
import * as rotary from './rotary.js';
import * as neuralamp from './neuralamp.js';

const mods = [
  compressor, drive, eq, cabinet, delay, reverb, chorus,
  boost, fuzz, octave, tremolo, vibrato, flanger, phaser, ringmod,
  autowah, gate, wah, tapeEcho, pingpong, widener, limiter,
  pitchshift, looper, autopan, rotary, neuralamp,
];
```

The existing `registry` builder (lines 36–38, unchanged) then keys it as `registry['neuralamp'] = { schema: neuralamp.schema, create: neuralamp.create }`.

- [ ] **Step 3: Add `'neuralamp'` to `AMP_TYPES` in `src/chain-state.js` (green part 2).** Change line 3 from `new Set(['drive', 'eq', 'cabinet'])` to include `'neuralamp'`. The final line reads exactly:

```js
const AMP_TYPES = new Set(['drive', 'eq', 'cabinet', 'neuralamp']);
```

No other edits: `fromPreset` (`locked: AMP_TYPES.has(e.type)`), `ampBounds`, and `move`'s clamp all read this set, so `neuralamp` now behaves as a locked amp-head member with no further changes.

- [ ] **Step 4: Run the new test and the full suite (green).**

```
npx vitest run tests/neuralamp-registry.test.js && npx vitest run
```

Expected output (new file passes; whole suite still green):

```
 ✓ tests/neuralamp-registry.test.js (7 tests)

 Test Files  1 passed (1)
      Tests  7 passed (7)
...
 Test Files  44 passed (44)
      Tests  (all) passed
```

- [ ] **Step 5: Commit.**

```
cd /Users/tal/Documents/guitar_web-neural && git add src/effects/index.js src/chain-state.js tests/neuralamp-registry.test.js && git commit -m "$(cat <<'EOF'
feat(neural): register neuralamp effect and lock it as an amp-head type

Add neuralamp to the effect registry (src/effects/index.js) and to
AMP_TYPES (src/chain-state.js) so it renders in the amp head and is
fenced from pedal slots (fromPreset lock, ampBounds, move clamp).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: one commit created with 3 files changed (`src/effects/index.js`, `src/chain-state.js`, `tests/neuralamp-registry.test.js`).

---

### Task 4: Neural amp render case in `renderAmp` (amp/model select + Trim/Level knobs)

`neuralamp` is an `AMP_TYPES` member, so it renders in the amp head (not as a pedal). Its `model` param is a discrete chooser (0..4 → one of 5 captured amps), which is wrong for a sweepable knob — it must be an `<select>`. `trim` and `level` stay as ordinary amp knobs. Every control fires the exact same `onParamChange(instanceId, key, value)` handler the head already uses for drive/eq/cabinet, so the rest of the chain-UI wiring is untouched. This is a purely additive branch inside `renderAmp`'s `modules.forEach` loop.

**Files:**
- Modify: `/Users/tal/Documents/guitar_web-neural/src/chain-ui/amp.js` — add `NEURAL_LABELS` constant (after `AMP_KNOB_STYLE`, line 8); replace the `modules.forEach` body (lines 64–79) with the neuralamp-aware version.
- Modify: `/Users/tal/Documents/guitar_web-neural/index.html` — add `.amp-model-select` CSS after `.amp-group-knobs` (line 279).
- Modify: `/Users/tal/Documents/guitar_web-neural/tests/amp.test.js` — append a `renderAmp neuralamp head` describe block after the final `});` (line 81).

**Interfaces:**
- Consumes: `renderAmp(container: HTMLElement, modules: Module[], onParamChange: (instanceId:number, key:string, value:number)=>void, opts?)` where a neuralamp `Module` = `{ instanceId:number, type:'neuralamp', schema:{ label:'Neural Amp', params:[{key:'model',label:'Amp',min:0,max:4,default:0,step:1},{key:'trim',...},{key:'level',...}] }, params:{ model:number, trim:number, level:number } }`.
- Consumes: `createKnob(param, value:number, onChange:(v:number)=>void, size:number, style) → { el, setValue }` from `./knob.js`.
- Produces: DOM `select.amp-model-select` (5 `<option>`s) + two `[role=slider]` knobs; on interaction calls `onParamChange(instanceId, 'model'|'trim'|'level', value:number)` — identical signature to the existing amp-head param path.

---

- [ ] **Step 1: Write the failing test — neuralamp head renders a model `<select>` + Trim/Level knobs and fires the shared handler.**

Append this block to `/Users/tal/Documents/guitar_web-neural/tests/amp.test.js` (after the closing `});` of the existing `describe('renderAmp', …)` at line 81):

```js
describe('renderAmp neuralamp head', () => {
  const neuralModule = () => ({
    instanceId: 20,
    type: 'neuralamp',
    schema: {
      label: 'Neural Amp',
      params: [
        { key: 'model', label: 'Amp', min: 0, max: 4, default: 0, step: 1 },
        { key: 'trim', label: 'Trim', min: 0, max: 10, default: 5, step: 0.1 },
        { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
      ],
    },
    params: { model: 2, trim: 5, level: 5 },
  });

  it('renders a model <select> with a friendly option per amp and Trim/Level as knobs', () => {
    const el = document.createElement('div');
    renderAmp(el, [neuralModule()], () => {}, { collapsed: false });
    const sel = el.querySelector('.amp-model-select');
    expect(sel).toBeTruthy();
    expect(sel.tagName).toBe('SELECT');
    expect(sel.querySelectorAll('option')).toHaveLength(5);
    expect(sel.querySelectorAll('option')[0].textContent).toBe('Marshall JCM');
    // 'model' is the <select>, NOT a knob → only Trim + Level are sliders.
    expect(el.querySelectorAll('[role=slider]')).toHaveLength(2);
    const labels = [...el.querySelectorAll('.amp-knob-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Trim', 'Level']);
    // select reflects the current model index
    expect(sel.value).toBe('2');
    expect(sel.selectedOptions[0].textContent).toBe('Fender Deluxe');
  });

  it('changing the model select fires onParamChange(instanceId, "model", index)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, [neuralModule()], cb, { collapsed: false });
    const sel = el.querySelector('.amp-model-select');
    sel.value = '4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(cb).toHaveBeenCalledWith(20, 'model', 4);
  });

  it('a Trim knob change fires onParamChange(instanceId, "trim", value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, [neuralModule()], cb, { collapsed: false });
    const firstKnob = el.querySelector('.amp-group [role=slider]');
    expect(firstKnob.getAttribute('aria-label')).toBe('Trim');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(20, 'trim', 5.1);
  });
});
```

Run it and confirm it fails for the right reason (no `.amp-model-select` yet — the branch does not exist):

```
cd /Users/tal/Documents/guitar_web-neural && npx vitest run tests/amp.test.js
```

Expected output (abridged) — the three new specs fail, existing renderAmp specs still pass:

```
 FAIL  tests/amp.test.js > renderAmp neuralamp head > renders a model <select> ...
   AssertionError: expected null to be truthy
 FAIL  tests/amp.test.js > renderAmp neuralamp head > changing the model select ...
 FAIL  tests/amp.test.js > renderAmp neuralamp head > a Trim knob change ...
 Test Files  1 failed (1)
      Tests  3 failed | 8 passed (11)
```

- [ ] **Step 2: Add the `NEURAL_LABELS` constant to `amp.js`.**

Insert directly after `AMP_KNOB_STYLE` (line 8) in `/Users/tal/Documents/guitar_web-neural/src/chain-ui/amp.js`:

```js
// Black numbered knobs for the amp panel; arc follows the theme accent (no
// inline stroke), pointer is white, with an engraved 0..10 number ring.
const AMP_KNOB_STYLE = { cap: ['#3a3a40', '#1a1a1e', '#08080a'], pointer: '#f4f4f6', numbered: true };

// Friendly captured-amp names for the neural amp head's model <select>. Index
// order matches MODELS in src/effects/neuralamp.js: ['jcm','5153','deluxe','ac10','jc'].
const NEURAL_LABELS = ['Marshall JCM', 'EVH 5153', 'Fender Deluxe', 'Vox AC10', 'Roland JC'];
```

- [ ] **Step 3: Replace the `modules.forEach` body with the neuralamp-aware branch.**

In `/Users/tal/Documents/guitar_web-neural/src/chain-ui/amp.js`, replace lines 64–79 (the current `modules.forEach((m) => { … });` block) with:

```js
  modules.forEach((m) => {
    const group = el('div', 'amp-group');
    const gh = el('div', 'amp-group-head');
    gh.textContent = m.schema.label;
    const row = el('div', 'amp-group-knobs');

    // Neural amp head: the 'model' param is a discrete captured-amp chooser, so
    // it renders as a <select> (not a sweepable knob). It sits between the group
    // head and the Trim/Level knob row and fires the SAME onParamChange handler.
    const modelParam = m.type === 'neuralamp' ? m.schema.params.find((p) => p.key === 'model') : null;
    group.appendChild(gh);
    if (modelParam) {
      const sel = el('select', 'amp-model-select');
      sel.setAttribute('aria-label', modelParam.label);
      NEURAL_LABELS.forEach((name, i) => {
        const o = el('option');
        o.value = String(i);
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.value = String(m.params[modelParam.key] ?? modelParam.default);
      sel.addEventListener('change', () => onParamChange(m.instanceId, modelParam.key, Number(sel.value)));
      group.appendChild(sel);
    }

    for (const p of m.schema.params) {
      if (p === modelParam) continue; // rendered as the <select> above
      const slot = el('div', 'amp-knob');
      const { el: kEl } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(m.instanceId, p.key, v), 44, AMP_KNOB_STYLE);
      const lbl = el('div', 'amp-knob-label');
      lbl.textContent = p.label;
      slot.append(kEl, lbl);
      row.appendChild(slot);
    }
    group.appendChild(row);
    panel.appendChild(group);
  });
```

This keeps the existing DOM order for non-neuralamp modules (`gh` → `row`, no `<select>`, `modelParam === null` so every param becomes a knob), so all prior `renderAmp` tests still pass. `buildStrip`/`syncStrip` are unaffected: they key off `.amp-knob`/`.amp-group-head`, and the neural head still exposes Trim/Level as `.amp-knob` chips.

- [ ] **Step 4: Style the model select to match the brushed panel.**

In `/Users/tal/Documents/guitar_web-neural/index.html`, add after `.amp-group-knobs { … }` (line 279):

```css
  .amp-group-knobs { display: flex; gap: 10px; align-items: flex-start; }
  .amp-model-select {
    position: relative; z-index: 1; margin-bottom: 10px; max-width: 112px;
    font: 700 9px/1.2 var(--font); letter-spacing: 0.04em; color: #23252a;
    padding: 3px 6px; border-radius: 5px; border: 1px solid #6a6c71;
    background: linear-gradient(180deg, #e9ebee, #c6c9cf);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 1px 2px rgba(0,0,0,0.35);
    cursor: pointer;
  }
```

- [ ] **Step 5: Run the test and confirm green.**

```
cd /Users/tal/Documents/guitar_web-neural && npx vitest run tests/amp.test.js
```

Expected output (abridged):

```
 ✓ tests/amp.test.js (11)
   ✓ renderAmp > renders a group per module and a knob per param
   ✓ renderAmp > a knob change calls onParamChange(instanceId, key, value)
   ✓ renderAmp neuralamp head > renders a model <select> with a friendly option per amp and Trim/Level as knobs
   ✓ renderAmp neuralamp head > changing the model select fires onParamChange(instanceId, "model", index)
   ✓ renderAmp neuralamp head > a Trim knob change fires onParamChange(instanceId, "trim", value)
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] **Step 6: Run the full unit suite to confirm no regressions.**

```
cd /Users/tal/Documents/guitar_web-neural && npx vitest run
```

Expected: all test files pass (the pre-existing `renderAmp` specs plus the 3 new neuralamp specs), zero failures.

- [ ] **Step 7: Commit.**

```
cd /Users/tal/Documents/guitar_web-neural && git add src/chain-ui/amp.js index.html tests/amp.test.js && git commit -m "$(cat <<'EOF'
feat(amp-ui): neuralamp render case — model select + Trim/Level knobs

renderAmp now renders neuralamp as an amp/model <select> (5 friendly
captured-amp names) plus Trim/Level knobs, all wired to the shared
onParamChange(instanceId, key, value) handler. jsdom test covers the
select, the two knobs, and both handler paths.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Add the "05 Professional" preset category and skip offline loudness for neural presets

Adds the 5 built-in captured-amp presets to the sound browser and short-circuits the offline loudness-measurement path so neural presets use their fixed, pre-measured `normDb` instead (design §7 — an `OfflineAudioContext` can't await the worklet's wasm+`.nam` load). Follows TDD: write the failing test first, then make it pass.

**Files:**
- Create: `/Users/tal/Documents/guitar_web-neural/src/presets/pro-jcm.json`
- Create: `/Users/tal/Documents/guitar_web-neural/src/presets/pro-5153.json`
- Create: `/Users/tal/Documents/guitar_web-neural/src/presets/pro-deluxe.json`
- Create: `/Users/tal/Documents/guitar_web-neural/src/presets/pro-ac10.json`
- Create: `/Users/tal/Documents/guitar_web-neural/src/presets/pro-jc.json`
- Create: `/Users/tal/Documents/guitar_web-neural/tests/pro-presets.test.js`
- Modify: `/Users/tal/Documents/guitar_web-neural/src/presets.js` (imports at lines 14–15; `PRESETS` at lines 18–20; `GB_CATEGORIES` at lines 24–29)
- Modify: `/Users/tal/Documents/guitar_web-neural/src/normalize.js` (add `isNeuralChain` after the `OfflineCtx` const at lines 41–42; guard at the top of `measureLoudnessGain`, lines 73–77)
- Modify: `/Users/tal/Documents/guitar_web-neural/src/main.js` (import at line 18; state after line 188; `loadPreset` at line 325; `loadTrackPatch` at line 350; `loadStoredChain` at lines 462–464; `scheduleNormalize` at lines 469–482)

**Interfaces:**
- Consumes: `registry['neuralamp']` from `src/effects/index.js` (registered in an earlier task) with `schema.params` keys `model`,`trim`,`level`; `MODELS: string[]` (length 5) from `src/effects/neuralamp.js`; `validatePreset(preset, registry): string[]` from `src/presets.js`; `chainState.signature(chain)`, `chainState.toEngineChain(chain)`.
- Produces:
  - `GB_CATEGORIES` gains `{ id:'pro', label:'05 Professional', presets:[5 presets] }`.
  - 5 preset objects shaped `{ name:string, category:'pro', normDb:number, chain:[{ type:'neuralamp', params:{ model:number, trim:5, level:5 } }] }`.
  - `isNeuralChain(chain: {type:string}[]): boolean` (new export in `src/normalize.js`).
  - `measureLoudnessGain(chain, opts?): Promise<number|null>` — now returns `null` (skip) when `isNeuralChain(chain)` is true, `1` when no `OfflineAudioContext`, else the measured linear gain.

---

- [ ] **Step 1: Write the failing test** — create `/Users/tal/Documents/guitar_web-neural/tests/pro-presets.test.js`

```js
import { describe, it, expect } from 'vitest';
import { GB_CATEGORIES, validatePreset } from '../src/presets.js';
import { registry } from '../src/effects/index.js';
import { isNeuralChain, measureLoudnessGain } from '../src/normalize.js';
import { MODELS } from '../src/effects/neuralamp.js';

describe('05 Professional category', () => {
  const pro = GB_CATEGORIES.find((c) => c.id === 'pro');

  it('exists with the "05 Professional" label and exactly 5 presets', () => {
    expect(pro).toBeTruthy();
    expect(pro.label).toBe('05 Professional');
    expect(pro.presets).toHaveLength(5);
  });

  it('every preset is a single neuralamp amp-head with a fixed normDb and valid model index', () => {
    for (const p of pro.presets) {
      expect(p.category).toBe('pro');
      expect(typeof p.normDb).toBe('number');
      expect(Number.isFinite(p.normDb)).toBe(true);
      expect(p.chain).toHaveLength(1);
      const node = p.chain[0];
      expect(node.type).toBe('neuralamp');
      expect(node.params.model).toBeGreaterThanOrEqual(0);
      expect(node.params.model).toBeLessThan(MODELS.length);
      expect(node.params.trim).toBe(5);
      expect(node.params.level).toBe(5);
      // Passes registry validation (neuralamp registered, only known params).
      expect(validatePreset(p, registry)).toEqual([]);
    }
  });

  it('covers all five distinct model indices 0..4', () => {
    const idx = pro.presets.map((p) => p.chain[0].params.model).sort();
    expect(idx).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('loudness normalize skips neural presets (design §7)', () => {
  it('isNeuralChain detects a neuralamp node anywhere in the chain', () => {
    expect(isNeuralChain([{ type: 'neuralamp', params: {} }])).toBe(true);
    expect(isNeuralChain([{ type: 'drive', params: {} }, { type: 'neuralamp', params: {} }])).toBe(true);
    expect(isNeuralChain([{ type: 'drive', params: {} }, { type: 'reverb', params: {} }])).toBe(false);
    expect(isNeuralChain([])).toBe(false);
    expect(isNeuralChain(null)).toBe(false);
  });

  it('measureLoudnessGain short-circuits to null for neural chains (not the offline-fallback 1)', async () => {
    // Neural → null: skipped, caller applies the preset's fixed normDb.
    await expect(measureLoudnessGain([{ type: 'neuralamp', params: {} }])).resolves.toBeNull();
    // Non-neural under jsdom (no OfflineAudioContext) → 1: the measurable path was entered.
    await expect(measureLoudnessGain([{ type: 'drive', params: {} }])).resolves.toBe(1);
  });
});
```

- [ ] **Step 2: Run the new test and confirm it fails (red)**

```
npx vitest run tests/pro-presets.test.js
```

Expected output (fails — `pro` category and `isNeuralChain` don't exist yet):

```
 FAIL  tests/pro-presets.test.js > 05 Professional category > exists with the "05 Professional" label and exactly 5 presets
AssertionError: expected undefined to be truthy
 FAIL  tests/pro-presets.test.js > loudness normalize skips neural presets (design §7) > isNeuralChain detects a neuralamp node anywhere in the chain
TypeError: isNeuralChain is not a function
 FAIL  tests/pro-presets.test.js > loudness normalize skips neural presets (design §7) > measureLoudnessGain short-circuits to null for neural chains (not the offline-fallback 1)
AssertionError: expected 1 to be null

 Test Files  1 failed (1)
      Tests  5 failed (5)
```

- [ ] **Step 3: Create the 5 Professional preset JSONs**

`/Users/tal/Documents/guitar_web-neural/src/presets/pro-jcm.json` (the full reference preset):

```json
{ "name": "Marshall JCM", "artist": "Neural Amp", "song": "Captured amp — Marshall JCM800 crunch", "category": "pro", "normDb": -4.0,
  "chain": [
    { "type": "neuralamp", "params": { "model": 0, "trim": 5, "level": 5 } }
  ] }
```

`/Users/tal/Documents/guitar_web-neural/src/presets/pro-5153.json`:

```json
{ "name": "EVH 5153", "artist": "Neural Amp", "song": "Captured amp — EVH 5153 high gain", "category": "pro", "normDb": -5.5,
  "chain": [
    { "type": "neuralamp", "params": { "model": 1, "trim": 5, "level": 5 } }
  ] }
```

`/Users/tal/Documents/guitar_web-neural/src/presets/pro-deluxe.json`:

```json
{ "name": "Fender Deluxe", "artist": "Neural Amp", "song": "Captured amp — Fender Deluxe clean/edge", "category": "pro", "normDb": -1.5,
  "chain": [
    { "type": "neuralamp", "params": { "model": 2, "trim": 5, "level": 5 } }
  ] }
```

`/Users/tal/Documents/guitar_web-neural/src/presets/pro-ac10.json`:

```json
{ "name": "Vox AC10", "artist": "Neural Amp", "song": "Captured amp — Vox AC10 chime", "category": "pro", "normDb": -2.5,
  "chain": [
    { "type": "neuralamp", "params": { "model": 3, "trim": 5, "level": 5 } }
  ] }
```

`/Users/tal/Documents/guitar_web-neural/src/presets/pro-jc.json`:

```json
{ "name": "Roland JC", "artist": "Neural Amp", "song": "Captured amp — Roland JC clean", "category": "pro", "normDb": -1.0,
  "chain": [
    { "type": "neuralamp", "params": { "model": 4, "trim": 5, "level": 5 } }
  ] }
```

- [ ] **Step 4: Register the presets and category in `src/presets.js`** — add the imports (after line 14), add them to `PRESETS`, and add the `pro` category.

Add the 5 imports:

```
import octaveDown from './presets/octave-down.json' with { type: 'json' };
import proJcm from './presets/pro-jcm.json' with { type: 'json' };
import pro5153 from './presets/pro-5153.json' with { type: 'json' };
import proDeluxe from './presets/pro-deluxe.json' with { type: 'json' };
import proAc10 from './presets/pro-ac10.json' with { type: 'json' };
import proJc from './presets/pro-jc.json' with { type: 'json' };
import { GB_PRESETS } from './presets/garageband.js';
```

Add them to the flat `PRESETS` list:

```
export const PRESETS = [clean, mayerEdge, mayerLead, knopflerSultans, asatoClean, hensonClean, hetfieldRhythm, hammettLead,
  funkAutowah, fuzzFace, ambientWash, surfTremolo, swirlPhaser, octaveDown,
  proJcm, pro5153, proDeluxe, proAc10, proJc,
  ...GB_PRESETS];
```

Add the category (after the `showcase` entry):

```
  { id: 'showcase', label: '04 Showcase FX', presets: [clean, funkAutowah, fuzzFace, ambientWash, surfTremolo, swirlPhaser, octaveDown] },
  // 05 Professional: real captured amps (NAM WaveNet). Each preset is a single
  // `neuralamp` amp-head node carrying a fixed, pre-measured normDb (the offline
  // loudness path can't render the wasm model — see normalize.js / design §7).
  { id: 'pro', label: '05 Professional', presets: [proJcm, pro5153, proDeluxe, proAc10, proJc] },
];
```

- [ ] **Step 5: Add `isNeuralChain` and short-circuit `measureLoudnessGain` in `src/normalize.js`**

Add the predicate right after the `OfflineCtx` const (lines 41–42):

```
const OfflineCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
  : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);

// A neural-amp chain can't be loudness-measured offline: its amp node is an
// AudioWorklet whose wasm engine + .nam model arrive asynchronously via
// postMessage, which an OfflineAudioContext render can't await (design §7).
// Detect it so callers skip the offline render and apply the preset's fixed,
// pre-measured normDb instead.
export function isNeuralChain(chain) {
  return Array.isArray(chain) && chain.some((e) => e && e.type === 'neuralamp');
}
```

Guard the top of `measureLoudnessGain` (before the `OfflineCtx` fallback check):

```
  if (isNeuralChain(chain)) return null; // neural: use the preset's fixed normDb (design §7)
  if (!OfflineCtx) return 1;
  const length = Math.floor(sampleRate * seconds);
```

- [ ] **Step 6: Apply the fixed normDb (and skip measuring) in `src/main.js`**

Extend the import (line 18):

```
import { measureLoudnessGain, isNeuralChain } from './normalize.js';
```

Add the normDb state (after `normSig`, line 188):

```
let normSig = null;      // last-measured chain structure signature
let currentNormDb = null; // fixed loudness offset for neural presets — the offline
                          // measure can't load their wasm+model (design §7)
```

Capture it in `loadPreset` (after `activePresetName = preset.name;`, line 325):

```
  activePresetName = preset.name;
  // Neural presets ship a fixed, pre-measured normDb (applied in scheduleNormalize).
  currentNormDb = typeof preset.normDb === 'number' ? preset.normDb : null;
```

Reset it in `loadTrackPatch` (at `activePresetName = p.name || null;`, line 350):

```
  activePresetName = p.name || null;
  currentNormDb = null; // track patches don't persist normDb; neural falls back to unity
  rebuildGraph();
```

Reset it in `loadStoredChain` (lines 462–464):

```
  const r = chainState.fromPreset(valid, nextId);
  currentChain = r.chain; nextId = r.nextId;
  currentNormDb = null; // persisted chains don't carry normDb; neural falls back to unity
  rebuildGraph();
```

Short-circuit `scheduleNormalize` (lines 469–482):

```
function scheduleNormalize() {
  if (!normGain) return;
  // Neural presets: skip the offline render entirely — their AudioWorklet wasm +
  // .nam model can't be loaded/awaited in an OfflineAudioContext (design §7).
  // Apply the preset's fixed, pre-measured normDb directly (0 dB / unity if the
  // chain arrived without one, e.g. restored via a track patch).
  if (isNeuralChain(currentChain)) {
    normGain.gain.value = 10 ** ((currentNormDb ?? 0) / 20);
    normSig = null;          // force a fresh measure when a normal preset loads next
    clearTimeout(normTimer);
    return;
  }
  // Reverb wet mix affects output loudness, so fold it into the signature.
  const sig = chainState.signature(currentChain) + `|rv${ampReverb.size},${ampReverb.mix}`;
  if (sig === normSig) return;
  normSig = sig;
  clearTimeout(normTimer);
  normTimer = setTimeout(async () => {
    try {
      const g = await measureLoudnessGain(chainState.toEngineChain(currentChain), { sampleRate: ctx ? ctx.sampleRate : 48000, reverb: ampReverb });
      if (g != null && normGain && chainState.signature(currentChain) === sig) normGain.gain.value = g;
    } catch (e) { console.warn('loudness normalize failed:', e); }
  }, 150);
}
```

- [ ] **Step 7: Run the test and the full suite; confirm green**

```
npx vitest run tests/pro-presets.test.js && npm test
```

Expected output (new file passes; nothing else regresses):

```
 ✓ tests/pro-presets.test.js (5)
   ✓ 05 Professional category (3)
   ✓ loudness normalize skips neural presets (design §7) (2)

 Test Files  1 passed (1)
      Tests  5 passed (5)
...
 Test Files  N passed (N)
      Tests  M passed (M)
```

- [ ] **Step 8: Commit**

```
cd /Users/tal/Documents/guitar_web-neural && git add \
  src/presets/pro-jcm.json src/presets/pro-5153.json src/presets/pro-deluxe.json \
  src/presets/pro-ac10.json src/presets/pro-jc.json \
  src/presets.js src/normalize.js src/main.js tests/pro-presets.test.js && \
git commit -m "feat(neural): 05 Professional preset category + fixed-normDb loudness skip

Add 5 captured-amp presets (Marshall JCM, EVH 5153, Fender Deluxe, Vox AC10,
Roland JC) as a new '05 Professional' browser category, each a single neuralamp
amp-head node carrying a pre-measured normDb. Skip the OfflineAudioContext
loudness measurement for neural chains (isNeuralChain -> measureLoudnessGain
returns null) and apply the fixed normDb in scheduleNormalize, since the
worklet's wasm+model can't be awaited offline (design §7).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

I have everything I need. Here is the task section.

---

### Task 6: Input-channel (1/2) selection for the live input

Lets the user pick which hardware input channel of a 2-in interface feeds the effect chain (e.g. guitar plugged into input 2). Requests a stereo capture, inserts a `ChannelSplitterNode(2)` after the `MediaStreamAudioSourceNode`, and routes the selected channel into `calibrationEq`. The routing itself is extracted into a pure, unit-tested helper because `src/main.js` runs DOM side effects on import and cannot be imported by vitest.

**Files:**
- Create: `/Users/tal/Documents/guitar_web-neural/src/audio/input-channel.js`
- Create: `/Users/tal/Documents/guitar_web-neural/tests/input-channel.test.js`
- Modify: `/Users/tal/Documents/guitar_web-neural/src/main.js`
  - import (after line 29, `import * as reverbFx from './effects/reverb.js';`)
  - module state (after line 38, `let calibrationEq, calibRAF, calibState, calibCountdown;`)
  - getUserMedia audio constraints (lines 630–631)
  - splitter insert (lines 668–671, replacing the `source.connect(calibrationEq.input)` wiring)
  - `setInputChannel` new function (after `stop()` ends, line 710)
  - stop() teardown null-out (line 705)
  - event wiring (after line 736, the calib listeners block)
- Modify: `/Users/tal/Documents/guitar_web-neural/index.html`
  - Devices section, after the `#output` select (line 843)

**Interfaces:**
- Produces: `connectInputChannel(splitter: ChannelSplitterNode, channel: number, dest: AudioNode): void` — exported from `src/audio/input-channel.js`; disconnects the splitter's outputs then connects output `channel` → `dest`.
- Produces (module-local in `src/main.js`): `setInputChannel(ch: number): void` — updates module state `inputChannel` and live re-routes if the graph exists.
- Consumes: `ctx.createChannelSplitter(2)` (Web Audio); `source: MediaStreamAudioSourceNode` (main.js line 645); `calibrationEq.input: AudioNode` (from `createCalibrationEq`, main.js line 669).

---

- [ ] **Step 1: Write the failing unit test for the routing helper (RED).**

Create `/Users/tal/Documents/guitar_web-neural/tests/input-channel.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { connectInputChannel } from '../src/audio/input-channel.js';

// Minimal spy standing in for a ChannelSplitterNode: records the output index
// passed to connect() (the shared FakeAudioContext ignores connect()'s 2nd arg).
function fakeSplitter() {
  return {
    connections: [],
    disconnectCount: 0,
    connect(dest, output) { this.connections.push({ dest, output }); },
    disconnect() { this.disconnectCount++; this.connections = []; },
  };
}

describe('connectInputChannel', () => {
  it('routes channel 0 (input 1) to the destination on output index 0', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 0, dest);
    expect(sp.connections).toEqual([{ dest, output: 0 }]);
  });

  it('routes channel 1 (input 2) to the destination on output index 1', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 1, dest);
    expect(sp.connections).toHaveLength(1);
    expect(sp.connections[0].dest).toBe(dest);
    expect(sp.connections[0].output).toBe(1);
  });

  it('disconnects prior routing before re-connecting (live re-route)', () => {
    const sp = fakeSplitter();
    const dest = { id: 'calibEq' };
    connectInputChannel(sp, 0, dest);   // initial: input 1
    connectInputChannel(sp, 1, dest);   // user switches to input 2
    expect(sp.disconnectCount).toBe(2);
    expect(sp.connections).toEqual([{ dest, output: 1 }]); // only latest routing remains
  });
});
```

Run it and confirm it fails because the module does not exist yet:

```
npx vitest run tests/input-channel.test.js
```

Expected output (RED):

```
Error: Failed to load url ../src/audio/input-channel.js (resolved id: ...) in tests/input-channel.test.js. Does the file exist?
```

- [ ] **Step 2: Create the routing helper (GREEN).**

Create `/Users/tal/Documents/guitar_web-neural/src/audio/input-channel.js`:

```js
// src/audio/input-channel.js
// Route one output of a ChannelSplitterNode to a destination node.
//   splitter output `channel` -> dest
//   channel 0 = hardware input 1 (left), channel 1 = hardware input 2 (right)
// The splitter's outputs are disconnected first so setInputChannel() can
// re-route a live graph without stacking connections.
export function connectInputChannel(splitter, channel, dest) {
  splitter.disconnect();
  splitter.connect(dest, channel);
}
```

Re-run the test and confirm it passes:

```
npx vitest run tests/input-channel.test.js
```

Expected output (GREEN):

```
 ✓ tests/input-channel.test.js (3 tests) ...
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

- [ ] **Step 3: Import the helper and add module state in `src/main.js`.**

Add the import immediately after line 29 (`import * as reverbFx from './effects/reverb.js';`):

```js
import { connectInputChannel } from './audio/input-channel.js';
```

Add the module state immediately after line 38 (`let calibrationEq, calibRAF, calibState, calibCountdown;`):

```js
let inputSplitter = null;   // ChannelSplitterNode after source; picks a hardware input channel
let inputChannel = 0;       // selected input channel: 0 = input 1, 1 = input 2 (persists across power cycles)
```

- [ ] **Step 4: Request a stereo capture in `getUserMedia`.**

In `start()`, change the audio constraints (lines 630–631). Replace:

```js
      audio: { deviceId: $('input').value ? { exact: $('input').value } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 },
```

with:

```js
      audio: { deviceId: $('input').value ? { exact: $('input').value } : undefined,
        channelCount: 2,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 },
```

- [ ] **Step 5: Insert the splitter, add `setInputChannel`, and update teardown/wiring in `src/main.js`.**

Insert the splitter between `source` and `calibrationEq`. Replace lines 668–671:

```js
    // Calibration EQ sits between source and the artist chain.
    calibrationEq = createCalibrationEq(ctx);
    source.connect(calibrationEq.input);
    applyActiveCalibration();
```

with:

```js
    // Calibration EQ sits between source and the artist chain. A ChannelSplitter
    // in front of it lets the user pick which hardware input channel (1 or 2)
    // feeds the chain — e.g. a 2-in interface with the guitar on input 2.
    calibrationEq = createCalibrationEq(ctx);
    inputSplitter = ctx.createChannelSplitter(2);
    source.connect(inputSplitter);
    connectInputChannel(inputSplitter, inputChannel, calibrationEq.input);
    applyActiveCalibration();
```

In `stop()`, add `inputSplitter` to the null-out list. Replace line 705:

```js
  ctx = stream = source = engine = gainOut = normGain = analyser = calibrationEq = reverbStage = null;
```

with:

```js
  ctx = stream = source = engine = gainOut = normGain = analyser = calibrationEq = reverbStage = inputSplitter = null;
```

Add the `setInputChannel` function immediately after the `stop()` function's closing brace (after line 710):

```js
// Re-route the live input to a different hardware channel (1 or 2). Persists the
// selection so it survives power cycles; no-op on the graph until Start wires it.
function setInputChannel(ch) {
  inputChannel = ch | 0;
  if (inputSplitter && calibrationEq) connectInputChannel(inputSplitter, inputChannel, calibrationEq.input);
}
```

Wire the `<select>` change handler. Add immediately after line 736 (`$('calib-start').addEventListener('click', startCalibration);`):

```js
$('input-channel').addEventListener('change', (e) => setInputChannel(+e.target.value));
```

- [ ] **Step 6: Add the channel `<select>` to `index.html`.**

In the Devices section, insert after the `#output` select (line 843, `<select id="output"></select>`):

```html
      <label for="input-channel">Input channel</label>
      <select id="input-channel">
        <option value="0">Channel 1</option>
        <option value="1">Channel 2</option>
      </select>
```

- [ ] **Step 7: Run the focused test plus the full suite to confirm no regressions.**

```
npx vitest run tests/input-channel.test.js && npx vitest run
```

Expected output:

```
 ✓ tests/input-channel.test.js (3 tests) ...
 ...
 Test Files  NN passed (NN)
      Tests  NNN passed (NNN)
```

(The full run must show 0 failed; `tests/input-channel.test.js` is included with 3 passing tests.)

- [ ] **Step 8: Commit.**

```
cd /Users/tal/Documents/guitar_web-neural && git add src/audio/input-channel.js tests/input-channel.test.js src/main.js index.html && git commit -m "feat(input): select hardware input channel 1/2 for live input

Request a stereo capture, split it with a ChannelSplitterNode(2) after the
MediaStreamSource, and route the selected channel into calibrationEq. Adds a
setInputChannel re-router, an #input-channel selector, and a unit-tested
connectInputChannel helper.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

Expected output:

```
[wow-backgrounds <hash>] feat(input): select hardware input channel 1/2 for live input
 4 files changed, NN insertions(+), N deletions(-)
 create mode 100644 src/audio/input-channel.js
 create mode 100644 tests/input-channel.test.js
```

---

### Task 7: End-to-end headless test — `05 Professional` neural amp in the live app

Prove, in a real headless Chromium against the app served by its own dev server, that a Professional preset makes the neural amp produce **finite, sustained, non-silent** output on the app's single `AudioContext`; that inserting a pedal **before** and **after** the amp audibly changes the output; that switching between all **5** Professional amps raises **no page errors**; and that the **input-channel selector** works. Modeled on the POC's `bench/benchmark.mjs` (spawn static server → launch Chromium with fake-media flags → poll output RMS across a sustained window → assert). Because the app is mic-driven and keeps `ctx`/`calibrationEq`/`normGain` as ES-module locals (no `window` exports), this task first adds a **tiny bridge installed only when the URL carries `?e2e=1`** — exactly the role `window.namPOC` played in the POC — then the test drives real code paths (`loadPreset`, `addEffect`, the real `#input-channel` select).

**Files:**
- Create: `/Users/tal/Documents/guitar_web-neural/tests/neural-e2e.mjs`
- Modify: `/Users/tal/Documents/guitar_web-neural/package.json` — add `playwright` devDep + `test:e2e` script (lines 5–14)
- Modify: `/Users/tal/Documents/guitar_web-neural/src/main.js` — install guarded bridge at end of `start()` (after `listDevices();`, line 687) and add the `installE2EBridge()` function between `start()` and `stop()` (insert after line 692)

**Interfaces:**
- Consumes (from earlier tasks, exact signatures already in the codebase):
  - `PRESETS`, `GB_CATEGORIES` from `src/presets.js` — the `pro` category `{ id:'pro', label:'05 Professional', presets:[…5…] }` (Presets task)
  - `loadPreset(preset)`, `addEffect(type, beforeId)`, module locals `ctx`, `calibrationEq` (`{input,output,apply,filters}`), `normGain`, `currentChain` — `src/main.js`
  - `neuralamp` registered in `registry` (`src/effects/index.js`) and worklet URL in `URLS` (`src/effects/worklets/index.js`); `'neuralamp'` ∈ `AMP_TYPES` so its chain unit is `locked` (`src/chain-state.js`)
  - DOM: `#power` (start/stop toggle, `index.html:797`), `#input-channel` (1/2 selector added by the Input-channel task, `index.html` near `#input:841`)
- Produces (the `?e2e=1` bridge, `window.__neuralE2E`):
  - `booted() -> boolean` (`!!ctx && ctx.state==='running'`)
  - `sampleRate() -> number`
  - `clock() -> { ctxTime:number, wall:number }`
  - `proPresetNames() -> string[]`
  - `chainTypes() -> string[]`
  - `loadPresetByName(name:string) -> true` (throws if unknown)
  - `feedTone(freq=110, amp=0.25) -> void` (continuous sawtooth into `calibrationEq.input`)
  - `stopTone() -> void`
  - `getOutputMetrics() -> { rms:number, finite:boolean, hf:number }` (tap on `normGain`; `hf` = fraction of energy ≥2 kHz)
  - `addPedalBefore(type:string) -> void`, `addPedalAfter(type:string) -> void` (relative to the `neuralamp` head unit)

---

- [ ] **Step 1: Add the Playwright dev dependency and the `test:e2e` script.**

Replace the entire contents of `/Users/tal/Documents/guitar_web-neural/package.json` with:

```json
{
  "name": "guitar-web",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "node tests/neural-e2e.mjs",
    "dev": "python3 -m http.server 8000"
  },
  "devDependencies": {
    "jsdom": "^25.0.0",
    "playwright": "^1.48.0",
    "vitest": "^2.1.0"
  }
}
```

Then install it:

```bash
cd /Users/tal/Documents/guitar_web-neural && npm install
```

Expected output (tail):

```
added 1 package, and audited N packages in Xs
found 0 vulnerabilities
```

- [ ] **Step 2: Download the Chromium browser Playwright drives.**

```bash
cd /Users/tal/Documents/guitar_web-neural && npx playwright install chromium
```

Expected output (already-cached machines print the second line):

```
Downloading Chromium ... 
Chromium ... playwright build vXXXX downloaded to /Users/tal/Library/Caches/ms-playwright/chromium-XXXX
```

- [ ] **Step 3: Add the `?e2e=1`-guarded test bridge to `src/main.js`.**

First, install it at the end of `start()`. Change:

```javascript
    updateTransport(); // enable skip-to-start now that we're powered
    listDevices();
  } catch (e) {
```

to:

```javascript
    updateTransport(); // enable skip-to-start now that we're powered
    listDevices();
    if (new URLSearchParams(location.search).has('e2e')) installE2EBridge();
  } catch (e) {
```

Then add the bridge function itself. Change:

```javascript
    console.error(e);
  }
}

function stop() {
```

to:

```javascript
    console.error(e);
  }
}

// ── E2E test bridge (headless Playwright only; installed when the URL has ?e2e=1) ──
// The app is mic-driven and keeps ctx/calibrationEq/normGain as module-locals, so a
// headless test can neither inject a deterministic signal nor read processed output.
// This closure exposes exactly enough of the LIVE graph to do both: a continuous
// sawtooth into the chain input (calibrationEq.input) and an RMS/HF tap on the wet
// bus (normGain). Never installed in normal use. See tests/neural-e2e.mjs.
function installE2EBridge() {
  let osc = null, toneGain = null, outTap = null;
  const proCat = () => GB_CATEGORIES.find((c) => c.id === 'pro');
  const neuralUnit = () => currentChain.find((u) => u.type === 'neuralamp');
  const ensureTap = () => {
    if (!outTap) { outTap = ctx.createAnalyser(); outTap.fftSize = 2048; normGain.connect(outTap); }
    return outTap;
  };
  const api = {
    booted: () => !!ctx && ctx.state === 'running',
    sampleRate: () => ctx.sampleRate,
    clock: () => ({ ctxTime: ctx.currentTime, wall: performance.now() }),
    proPresetNames: () => (proCat() ? proCat().presets.map((p) => p.name) : []),
    chainTypes: () => currentChain.map((u) => u.type),
    loadPresetByName: (name) => {
      const p = PRESETS.find((x) => x.name === name);
      if (!p) throw new Error('no preset named ' + name);
      loadPreset(p);
      return true;
    },
    feedTone: (freq = 110, amp = 0.25) => {
      api.stopTone();
      osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
      toneGain = ctx.createGain(); toneGain.gain.value = amp;
      osc.connect(toneGain).connect(calibrationEq.input);
      osc.start();
    },
    stopTone: () => {
      if (osc) { try { osc.stop(); } catch {} osc.disconnect(); osc = null; }
      if (toneGain) { toneGain.disconnect(); toneGain = null; }
    },
    getOutputMetrics: () => {
      const a = ensureTap();
      const t = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(t);
      let sum = 0, finite = true;
      for (let i = 0; i < t.length; i++) { const v = t[i]; if (!Number.isFinite(v)) finite = false; sum += v * v; }
      const f = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(f); // magnitude in dB
      const binHz = (ctx.sampleRate / 2) / f.length;
      let lo = 0, hi = 0;
      for (let i = 0; i < f.length; i++) { const p = Math.pow(10, f[i] / 10); if (i * binHz >= 2000) hi += p; else lo += p; }
      return { rms: Math.sqrt(sum / t.length), finite, hf: hi / (lo + hi + 1e-12) };
    },
    addPedalBefore: (type) => { const amp = neuralUnit(); addEffect(type, amp ? amp.instanceId : null); },
    addPedalAfter: (type) => {
      const amp = neuralUnit();
      const i = currentChain.findIndex((u) => u.instanceId === amp.instanceId);
      const after = currentChain[i + 1];
      addEffect(type, after ? after.instanceId : null);
    },
  };
  window.__neuralE2E = api;
}

function stop() {
```

- [ ] **Step 4: Create the end-to-end test `tests/neural-e2e.mjs`.**

```javascript
// End-to-end functional test for the "05 Professional" neural amp, run in a real
// headless Chromium against the app served by its own dev server (python http.server,
// == `npm run dev`). Modeled on poc/nam-web/bench/benchmark.mjs.
//
// What this PROVES:
//   1. A Professional preset loads via the normal loadPreset path and the neural
//      worklet produces FINITE, SUSTAINED, NON-SILENT output on the app's own ctx
//      (min RMS over the whole window, not a single snapshot).
//   2. The graph runs in REALTIME (ctx clock advances ~1:1 with wall clock).
//   3. Inserting a pedal BEFORE the amp, and (separately) AFTER the amp, audibly
//      changes the output (RMS and/or spectral-HF distance beyond a threshold).
//   4. Switching between all 5 Professional amps yields non-silent output and
//      ZERO uncaught page errors.
//   5. The input-channel (1/2) selector switches without errors and audio survives.
//
// Run:  npm run test:e2e     (or: node tests/neural-e2e.mjs ; VERBOSE=1 for page logs)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 8901;
const URL = `http://localhost:${PORT}/?e2e=1`;

// Gates.
const MIN_RMS = 0.003;        // sustained non-silence — ~30x the ~1e-4 noise floor
const RT_LO = 0.9, RT_HI = 1.1;
const CHANGE = 0.05;          // min RMS-rel + HF distance to count as "output changed"
const WARMUP_FIRST_MS = 2500; // first .nam + wasm build
const WARMUP_SWITCH_MS = 1500;// subsequent .nam loads (wasm module cached)
const WINDOW_MS = 4000;       // sustained-output measurement window

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.abs(a.rms - b.rms) / Math.max(b.rms, 1e-6) + Math.abs(a.hf - b.hf);

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${PORT}/index.html`); if (r.status < 500) return proc; } catch {}
    await sleep(150);
  }
  proc.kill();
  throw new Error('dev server did not come up on port ' + PORT);
}

async function measure(page, ms) {
  const polls = Math.max(4, Math.round(ms / 300));
  let min = Infinity, sumR = 0, sumH = 0, finite = true, n = 0;
  for (let i = 0; i < polls; i++) {
    await sleep(ms / polls);
    const m = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
    min = Math.min(min, m.rms); sumR += m.rms; sumH += m.hf; finite = finite && m.finite; n++;
  }
  return { min, rms: sumR / n, hf: sumH / n, finite };
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  const fails = [];
  const check = (cond, msg) => { if (cond) { console.log('  PASS ' + msg); } else { fails.push(msg); console.log('  FAIL ' + msg); } };

  try {
    await page.goto(URL, { waitUntil: 'load' });

    // 0) Power on (a real user gesture) → the ?e2e bridge installs at end of start().
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    console.log('booted @ ' + (await page.evaluate(() => window.__neuralE2E.sampleRate())) + ' Hz');

    const pros = await page.evaluate(() => window.__neuralE2E.proPresetNames());
    console.log('Professional amps:', pros.join(', '));
    check(pros.length === 5, `05 Professional has 5 amps (got ${pros.length})`);

    // 1) First amp: finite, sustained non-silent, realtime.
    await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), pros[0]);
    await page.evaluate(() => window.__neuralE2E.feedTone(110, 0.25));
    await sleep(WARMUP_FIRST_MS);
    const chain = await page.evaluate(() => window.__neuralE2E.chainTypes());
    check(chain.includes('neuralamp'), `preset "${pros[0]}" put neuralamp in the chain (${chain.join('>')})`);

    const clk0 = await page.evaluate(() => window.__neuralE2E.clock());
    const base = await measure(page, WINDOW_MS);
    const clk1 = await page.evaluate(() => window.__neuralE2E.clock());
    const rt = (clk1.ctxTime - clk0.ctxTime) / ((clk1.wall - clk0.wall) / 1000);
    console.log(`  ${pros[0]}: minRMS ${base.min.toFixed(5)} avgRMS ${base.rms.toFixed(5)} hf ${base.hf.toFixed(3)} rt ${rt.toFixed(3)}x`);
    check(base.finite, 'neural output is finite (no NaN/Inf)');
    check(base.min >= MIN_RMS, `neural output sustained non-silent (minRMS ${base.min.toFixed(5)} >= ${MIN_RMS})`);
    check(rt >= RT_LO && rt <= RT_HI, `graph runs in realtime (ratio ${rt.toFixed(3)})`);

    // 2) Pedal BEFORE the amp changes the output.
    await page.evaluate(() => window.__neuralE2E.addPedalBefore('fuzz'));
    await sleep(800);
    const withBefore = await measure(page, 1500);
    const dBefore = dist(withBefore, base);
    console.log(`  +fuzz BEFORE: rms ${withBefore.rms.toFixed(5)} hf ${withBefore.hf.toFixed(3)} dist ${dBefore.toFixed(3)}`);
    check(withBefore.finite && dBefore > CHANGE, `pedal BEFORE amp changes output (dist ${dBefore.toFixed(3)} > ${CHANGE})`);

    // Reset to a clean Professional chain, then a pedal AFTER the amp changes output.
    await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), pros[0]);
    await sleep(WARMUP_SWITCH_MS);
    const base2 = await measure(page, 1500);
    await page.evaluate(() => window.__neuralE2E.addPedalAfter('delay'));
    await sleep(800);
    const withAfter = await measure(page, 1500);
    const dAfter = dist(withAfter, base2);
    console.log(`  +delay AFTER: rms ${withAfter.rms.toFixed(5)} hf ${withAfter.hf.toFixed(3)} dist ${dAfter.toFixed(3)}`);
    check(withAfter.finite && dAfter > CHANGE, `pedal AFTER amp changes output (dist ${dAfter.toFixed(3)} > ${CHANGE})`);

    // 3) Switch through all 5 amps: each non-silent, finite, no page errors.
    for (const name of pros) {
      await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), name);
      await sleep(WARMUP_SWITCH_MS);
      const m = await measure(page, 1500);
      console.log(`  switch → ${name}: minRMS ${m.min.toFixed(5)} finite ${m.finite}`);
      check(m.finite && m.min >= MIN_RMS, `amp "${name}" produces finite sustained output`);
    }

    // 4) Input-channel (1/2) selector: switch ch2 then ch1, audio survives, no errors.
    const chanCount = await page.locator('#input-channel').count();
    check(chanCount === 1, 'input-channel selector present (#input-channel)');
    if (chanCount === 1) {
      const optCount = await page.locator('#input-channel option').count();
      check(optCount >= 2, `input-channel offers 1/2 (got ${optCount} options)`);
      await page.selectOption('#input-channel', { index: 1 });
      await sleep(600);
      const ch2 = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
      check(ch2.finite, 'audio finite after selecting channel 2');
      await page.selectOption('#input-channel', { index: 0 });
      await sleep(600);
      const ch1 = await measure(page, 1500);
      check(ch1.finite && ch1.min >= MIN_RMS, `audio survives return to channel 1 (minRMS ${ch1.min.toFixed(5)})`);
    }

    await page.evaluate(() => window.__neuralE2E.stopTone());
    check(pageErrors.length === 0, `no uncaught page errors (got ${pageErrors.length})`);
    if (pageErrors.length) console.log('  PAGE ERRORS:\n   - ' + pageErrors.join('\n   - '));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n' + '='.repeat(64));
  const ok = fails.length === 0;
  console.log(ok
    ? '✅ NEURAL E2E PASS — Professional amps load, stream live, respond to pedals, switch cleanly, channel selector works.'
    : `❌ NEURAL E2E FAIL — ${fails.length} check(s):\n - ` + fails.join('\n - '));
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error('E2E ERROR:', e); process.exit(2); });
```

- [ ] **Step 5: Run the end-to-end test — it must pass.**

```bash
cd /Users/tal/Documents/guitar_web-neural && npm run test:e2e
```

Expected output:

```
> guitar-web@ test:e2e
> node tests/neural-e2e.mjs

booted @ 44100 Hz
Professional amps: Marshall JCM, EVH 5153, Fender Deluxe, Vox AC10, Roland JC
  PASS 05 Professional has 5 amps (got 5)
  PASS preset "Marshall JCM" put neuralamp in the chain (neuralamp)
  Marshall JCM: minRMS 0.04... avgRMS 0.05... hf 0.2... rt 1.00...x
  PASS neural output is finite (no NaN/Inf)
  PASS neural output sustained non-silent (minRMS 0.04... >= 0.003)
  PASS graph runs in realtime (ratio 1.00...)
  +fuzz BEFORE: rms 0.0... hf 0.3... dist 0.4...
  PASS pedal BEFORE amp changes output (dist 0.4... > 0.05)
  +delay AFTER: rms 0.0... hf 0.2... dist 0.1...
  PASS pedal AFTER amp changes output (dist 0.1... > 0.05)
  switch → Marshall JCM: minRMS 0.04... finite true
  PASS amp "Marshall JCM" produces finite sustained output
  switch → EVH 5153: minRMS 0.05... finite true
  PASS amp "EVH 5153" produces finite sustained output
  switch → Fender Deluxe: minRMS 0.03... finite true
  PASS amp "Fender Deluxe" produces finite sustained output
  switch → Vox AC10: minRMS 0.03... finite true
  PASS amp "Vox AC10" produces finite sustained output
  switch → Roland JC: minRMS 0.02... finite true
  PASS amp "Roland JC" produces finite sustained output
  PASS input-channel selector present (#input-channel)
  PASS input-channel offers 1/2 (got 2 options)
  PASS audio finite after selecting channel 2
  PASS audio survives return to channel 1 (minRMS 0.03...)
  PASS no uncaught page errors (got 0)

================================================================
✅ NEURAL E2E PASS — Professional amps load, stream live, respond to pedals, switch cleanly, channel selector works.
```

- [ ] **Step 6: Commit.**

```bash
cd /Users/tal/Documents/guitar_web-neural && git add tests/neural-e2e.mjs package.json package-lock.json src/main.js && git commit -m "$(cat <<'EOF'
test(neural): headless e2e for 05 Professional neural amp

Playwright test served by the app's own dev server (python http.server):
loads a Professional preset and asserts the neural worklet yields finite,
sustained, non-silent output on the app ctx in realtime; asserts a pedal
before and after the amp changes the output; switches all 5 Professional
amps with zero page errors; exercises the input-channel (1/2) selector.
Adds a ?e2e=1-guarded window.__neuralE2E bridge to main.js (never installed
in normal use) so the headless test can inject a deterministic tone and
read processed output RMS/HF off the wet bus.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected output:

```
[wow-backgrounds <hash>] test(neural): headless e2e for 05 Professional neural amp
 4 files changed, ... insertions(+)
 create mode 100644 tests/neural-e2e.mjs
```