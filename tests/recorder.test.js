// tests/recorder.test.js
import { describe, it, expect } from 'vitest';
import { concatChunks } from '../src/recorder.js';

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
});
