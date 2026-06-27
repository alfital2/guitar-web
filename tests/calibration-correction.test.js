// tests/calibration-correction.test.js
import { describe, it, expect } from 'vitest';
import { computeCorrection } from '../src/calibration/correction.js';

describe('computeCorrection', () => {
  it('flat fingerprint -> ~zero correction', () => {
    const c = computeCorrection([0, 0, 0, 0, 0], 1);
    c.forEach(v => expect(Math.abs(v)).toBeLessThan(1e-9));
  });
  it('strength 0 -> all zeros', () => {
    const c = computeCorrection([10, -10, 5, -5, 0], 0);
    c.forEach(v => expect(v).toBe(0));
  });
  it('opposes the fingerprint (boosts a dip, cuts a peak)', () => {
    const c = computeCorrection([10, 8, 0, -8, -10], 1);
    expect(c[0]).toBeLessThan(0);
    expect(c[4]).toBeGreaterThan(0);
  });
  it('caps at +/-6 dB before strength scaling', () => {
    const c = computeCorrection([100, 100, 100, 100, 100], 1);
    c.forEach(v => expect(v).toBeCloseTo(-6));
    const half = computeCorrection([100, 100, 100, 100, 100], 0.5);
    half.forEach(v => expect(v).toBeCloseTo(-3));
  });
});
