// src/effects/worklets/neural-amp-processor.js
//
// NAM WaveNet neural-amp engine (plain-wasm, single-thread) hosted as an
// AudioWorkletProcessor on the app's own AudioContext. Mirrors the wasm-loading
// approach de-risked in tools/neural/derisk-processor.js: the emscripten ES6
// glue (assets/neural/nam.js) is statically imported here (fetch is unavailable
// in AudioWorkletGlobalScope) and instantiated ONCE from bytes posted by the
// main thread, via `wasmBinary`. AudioWorkletGlobalScope has no global `URL`,
// so `Module.locateFile:(p)=>p` is required — otherwise emscripten's
// findWasmBinary() does `new URL(...)` internally and throws even though
// wasmBinary is provided. Runs dry passthrough until a model is loaded;
// steady-state process() is allocation-free (preallocated heap pointers +
// cached HEAPF32 views, re-fetched whenever the wasm memory buffer identity
// changes, e.g. after ALLOW_MEMORY_GROWTH).
//
// Message protocol (Task 2's effect module drives this):
//   IN  {type:'wasm',  bytes:ArrayBuffer} -> instantiate the module ONCE
//                                            -> OUT {type:'wasm-ready'}
//                                            (OUT {type:'wasm-error', error}
//                                             if instantiation throws; stays
//                                             dry, never aborts)
//   IN  {type:'model', json:string}       -> nam_load(json); on 1 ->
//                                            nam_reset(sampleRate, 128) ->
//                                            OUT {type:'ready'}; on 0 or a
//                                            throw -> OUT {type:'model-error'}
//                                            (wrapped in try/catch; stays in
//                                            passthrough, never aborts)
// Posting 'wasm' then 'model' back-to-back races the async instantiate — a
// 'model' that arrives before the wasm module is ready is queued and applied
// as soon as instantiation completes, so the caller doesn't strictly need to
// wait for 'wasm-ready' before sending 'model', though doing so (a proper
// handshake) avoids the queueing path entirely and is the intended usage.
//   process(inputs, outputs): ready -> allocation-free heap round-trip
//                              through nam_process; else -> passthrough
//                              (silence if there is no input channel)
import createNamModule from '../../../assets/neural/nam.js';

const BLOCK = 128; // Web Audio render quantum

class NeuralAmpProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mod = null;            // emscripten Module instance
    this.ready = false;         // true once nam_load succeeded (this session)
    this.instantiating = false; // guards single instantiation
    this.pendingModel = null;   // model json that arrived before wasm was ready
    this.inPtr = 0;
    this.outPtr = 0;
    this.namLoad = null;
    this.namReset = null;
    this.namProcess = null;
    this.heapBuf = null;        // ArrayBuffer identity backing the cached views
    this.inView = null;         // Float32Array view over [inPtr, inPtr+BLOCK)
    this.outView = null;        // Float32Array view over [outPtr, outPtr+BLOCK)
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  async onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'wasm') {
      if (this.mod || this.instantiating) return; // instantiate exactly once
      this.instantiating = true;
      try {
        // No fetch/URL in AudioWorkletGlobalScope: hand bytes via wasmBinary,
        // and short-circuit findWasmBinary()'s `new URL(...)` with locateFile.
        const mod = await createNamModule({ wasmBinary: msg.bytes, locateFile: (p) => p });
        this.inPtr = mod._malloc(BLOCK * 4);
        this.outPtr = mod._malloc(BLOCK * 4);
        this.namLoad = mod.cwrap('nam_load', 'number', ['string']);
        this.namReset = mod.cwrap('nam_reset', null, ['number', 'number']);
        this.namProcess = mod.cwrap('nam_process', null, ['number', 'number', 'number']);
        this.mod = mod;
        this.refreshViews();
        this.port.postMessage({ type: 'wasm-ready' });
        if (this.pendingModel !== null) {          // a model arrived before wasm
          const json = this.pendingModel;
          this.pendingModel = null;
          this.loadModel(json);
        }
      } catch (err) {
        this.mod = null;
        this.port.postMessage({ type: 'wasm-error', error: String((err && err.message) || err) });
      } finally {
        this.instantiating = false;
      }
    } else if (msg.type === 'model') {
      if (!this.mod) { this.pendingModel = msg.json; return; } // apply once wasm lands
      this.loadModel(msg.json);
    }
  }

  loadModel(json) {
    this.ready = false; // dry while (re)loading
    try {
      const ok = this.namLoad(json);
      if (ok) {
        this.namReset(sampleRate, BLOCK); // sampleRate: AudioWorkletGlobalScope global
        this.ready = true;
        this.port.postMessage({ type: 'ready' });
      } else {
        this.port.postMessage({ type: 'model-error', error: 'nam_load failed' });
      }
    } catch (err) {
      this.ready = false;
      this.port.postMessage({ type: 'model-error', error: String((err && err.message) || err) });
    }
  }

  refreshViews() {
    const heap = this.mod.HEAPF32;
    this.heapBuf = heap.buffer;
    this.inView = heap.subarray(this.inPtr >> 2, (this.inPtr >> 2) + BLOCK);
    this.outView = heap.subarray(this.outPtr >> 2, (this.outPtr >> 2) + BLOCK);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || !output.length) return true;
    const out = output[0];
    const input = inputs[0];
    const inCh = input && input[0] ? input[0] : null;
    const n = out.length;

    if (!this.ready) {                          // dry passthrough until model is live
      if (inCh) out.set(inCh); else out.fill(0);
      return true;
    }

    if (this.mod.HEAPF32.buffer !== this.heapBuf) this.refreshViews(); // memory grew
    const inView = this.inView, outView = this.outView;

    if (n === BLOCK) {                          // common path: allocation-free block copy
      if (inCh) inView.set(inCh); else inView.fill(0);
      this.namProcess(this.inPtr, this.outPtr, n);
      out.set(outView);
    } else {                                    // defensive: partial/odd quantum
      for (let i = 0; i < n; i++) inView[i] = inCh ? inCh[i] : 0;
      this.namProcess(this.inPtr, this.outPtr, n);
      for (let i = 0; i < n; i++) out[i] = outView[i];
    }
    return true;
  }
}

registerProcessor('neural-amp-processor', NeuralAmpProcessor);
