// tests/recorder.test.js
import { describe, it, expect } from 'vitest';
import { concatChunks, channelsDiffer } from '../src/recorder.js';

describe('channelsDiffer (mono-vs-stereo capture)', () => {
  it('identical channels (mono chain up-mixed) → false, so R is dropped', () => {
    const a = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i));
    const b = a.slice();
    expect(channelsDiffer(a, b)).toBe(false);
  });
  it('a Haas-delayed right channel → true (real stereo, keep R)', () => {
    const a = Float32Array.from({ length: 5000 }, (_, i) => Math.sin(i / 7));
    const b = new Float32Array(5000);
    for (let i = 40; i < 5000; i++) b[i] = a[i - 40]; // ~delayed copy
    expect(channelsDiffer(a, b)).toBe(true);
  });
  it('mismatched lengths or missing channel → true', () => {
    expect(channelsDiffer(new Float32Array(10), new Float32Array(11))).toBe(true);
    expect(channelsDiffer(new Float32Array(10), null)).toBe(true);
  });
});

describe('concatChunks', () => {
  it('joins chunks in order', () => {
    const out = concatChunks([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
  it('empty list → length 0', () => {
    expect(concatChunks([]).length).toBe(0);
  });
  it('preserves total length', () => {
    const out = concatChunks([new Float32Array(100), new Float32Array(250)]);
    expect(out.length).toBe(350);
  });
  it('skips null/undefined chunks (defensive vs a worklet version skew)', () => {
    const out = concatChunks([new Float32Array([1, 2]), undefined, new Float32Array([3]), null]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});
