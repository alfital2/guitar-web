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
