// tests/waveform.test.js
import { describe, it, expect } from 'vitest';
import { computePeaks } from '../src/waveform.js';

function sine(n, freq = 5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = Math.sin(2 * Math.PI * freq * i / n);
  return b;
}

describe('computePeaks', () => {
  it('returns `buckets` values', () => {
    expect(computePeaks(sine(1000), 32)).toHaveLength(32);
  });
  it('full-scale sine → peaks near 1', () => {
    const p = computePeaks(sine(2000, 20), 16);
    for (const v of p) expect(v).toBeGreaterThan(0.9);
  });
  it('silence → peaks 0', () => {
    const p = computePeaks(new Float32Array(1000), 10);
    for (const v of p) expect(v).toBe(0);
  });
  it('empty samples → zeros of length buckets', () => {
    expect(Array.from(computePeaks(new Float32Array(0), 4))).toEqual([0, 0, 0, 0]);
  });
});
