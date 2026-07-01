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
      // AudioWorkletGlobalScope has NO global `URL`; Emscripten's findWasmBinary()
      // calls `new URL('nam.wasm', import.meta.url)` UNLESS Module.locateFile is set.
      // We hand it the bytes via wasmBinary, so the returned path is never fetched —
      // locateFile just short-circuits the `new URL` that would otherwise throw.
      this.mod = await createNamModule({ wasmBinary: msg.bytes, locateFile: (p) => p });
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
