// tests/worklet-processors.test.js — exercises the AudioWorklet DSP directly by
// shimming the worklet global scope (AudioWorkletProcessor, registerProcessor,
// sampleRate), importing each processor module, and running process() over
// crafted buffers. This covers the real pitch-shift / looper logic without a
// browser.
import { describe, it, expect, beforeAll } from 'vitest';

const registered = {};

beforeAll(async () => {
  globalThis.sampleRate = 48000;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
  globalThis.registerProcessor = (name, ctor) => { registered[name] = ctor; };
  await import('../src/effects/worklets/pitchshift-processor.js');
  await import('../src/effects/worklets/looper-processor.js');
});

const kParam = (v) => Float32Array.of(v);
const block = (arr) => [[Float32Array.from(arr)]];          // one input, one channel
const out = (n) => [[new Float32Array(n)]];

describe('pitchshift-processor', () => {
  it('registers under its processor name', () => {
    expect(registered['pitchshift-processor']).toBeTypeOf('function');
  });

  it('is a perfect dry passthrough at mix=0', () => {
    const p = new registered['pitchshift-processor']();
    const input = Array.from({ length: 128 }, (_, i) => Math.sin(i / 5));
    const o = out(128);
    p.process(block(input), o, { semitones: kParam(7), mix: kParam(0) });
    for (let i = 0; i < 128; i++) expect(o[0][0][i]).toBeCloseTo(input[i], 6);
  });

  it('produces finite output (no NaN/Inf) when shifting a full octave', () => {
    const p = new registered['pitchshift-processor']();
    let ok = true;
    for (let b = 0; b < 20; b++) {
      const input = Array.from({ length: 128 }, (_, i) => Math.sin((b * 128 + i) * 0.02));
      const o = out(128);
      p.process(block(input), o, { semitones: kParam(-12), mix: kParam(1) });
      for (const v of o[0][0]) if (!Number.isFinite(v)) ok = false;
    }
    expect(ok).toBe(true);
  });
});

describe('looper-processor', () => {
  it('passes the dry signal through while recording', () => {
    const p = new registered['looper-processor']();
    const input = Array.from({ length: 64 }, (_, i) => i + 1);
    const o = out(64);
    p.process(block(input), o, { mode: kParam(1), level: kParam(1) }); // record
    for (let i = 0; i < 64; i++) expect(o[0][0][i]).toBe(input[i]);
  });

  it('plays back the recorded loop and wraps at loop length', () => {
    const p = new registered['looper-processor']();
    const rec = Array.from({ length: 64 }, (_, i) => i + 1);
    p.process(block(rec), out(64), { mode: kParam(1), level: kParam(1) }); // record 64 samples

    // Switch to play with silent input and unity level: output == looped record.
    const silence = new Array(96).fill(0);
    const o = out(96);
    p.process(block(silence), o, { mode: kParam(2), level: kParam(1) });
    for (let i = 0; i < 96; i++) expect(o[0][0][i]).toBe(rec[i % 64]); // wraps at 64
  });

  it('overdub sums new input onto the existing loop', () => {
    const p = new registered['looper-processor']();
    const rec = new Array(32).fill(2);
    p.process(block(rec), out(32), { mode: kParam(1), level: kParam(1) }); // loop of 2s

    const add = new Array(32).fill(5);
    const o = out(32);
    p.process(block(add), o, { mode: kParam(3), level: kParam(1) }); // overdub
    // output = dry(5) + existing loop(2); buffer now holds 7 for the next pass.
    for (let i = 0; i < 32; i++) expect(o[0][0][i]).toBe(7);
    const o2 = out(32);
    p.process(block(new Array(32).fill(0)), o2, { mode: kParam(2), level: kParam(1) });
    for (let i = 0; i < 32; i++) expect(o2[0][0][i]).toBe(7); // 2+5 baked in
  });
});
