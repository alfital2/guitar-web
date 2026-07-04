import { describe, it, expect } from 'vitest';
import { encodeWav } from '../src/wav.js';

const str = (view, off, len) => {
  let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i)); return s;
};

describe('encodeWav', () => {
  it('writes a valid 44-byte mono 16-bit PCM header', () => {
    const samples = new Float32Array(100);
    const view = new DataView(encodeWav(samples, 48000));
    expect(str(view, 0, 4)).toBe('RIFF');
    expect(str(view, 8, 4)).toBe('WAVE');
    expect(str(view, 36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1);        // mono
    expect(view.getUint32(24, true)).toBe(48000);    // sample rate
    expect(view.getUint16(34, true)).toBe(16);       // bits
    expect(view.getUint32(40, true)).toBe(200);      // data bytes = 100 samples * 2
    expect(view.byteLength).toBe(44 + 200);
  });

  it('round-trips sample values within 16-bit quantization', () => {
    const samples = Float32Array.from([0, 0.5, -0.5, 1, -1]);
    const view = new DataView(encodeWav(samples, 22050));
    const back = [];
    for (let i = 0; i < samples.length; i++) back.push(view.getInt16(44 + i * 2, true) / 0x7fff);
    expect(back[0]).toBeCloseTo(0, 3);
    expect(back[1]).toBeCloseTo(0.5, 3);
    expect(back[2]).toBeCloseTo(-0.5, 3);
    expect(back[3]).toBeCloseTo(1, 3);
    expect(back[4]).toBeCloseTo(-1, 3);
  });

  it('clamps out-of-range samples', () => {
    const view = new DataView(encodeWav(Float32Array.from([2, -2]), 8000));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
