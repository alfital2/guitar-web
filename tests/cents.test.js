// tests/cents.test.js
import { describe, it, expect } from 'vitest';
import { freqToCents } from '../src/pitch/cents.js';

describe('freqToCents', () => {
  it('A4 = 440 is exactly in tune', () => {
    const r = freqToCents(440);
    expect(r.name).toBe('A'); expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(0, 5); expect(r.midi).toBe(69);
  });
  it('445 reads A4 about +19.6 cents', () => {
    const r = freqToCents(445);
    expect(r.name).toBe('A'); expect(r.octave).toBe(4);
    expect(r.cents).toBeCloseTo(19.56, 1);
  });
  it('low E string 82.41 Hz is E2 ~0 cents', () => {
    const r = freqToCents(82.41);
    expect(r.name).toBe('E'); expect(r.octave).toBe(2);
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });
  it('466.16 is A#4 ~0 cents', () => {
    const r = freqToCents(466.16);
    expect(r.name).toBe('A#'); expect(r.octave).toBe(4);
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });
  it('refFreq is the nearest in-tune frequency', () => {
    expect(freqToCents(445).refFreq).toBeCloseTo(440, 3);
  });
  it('returns null for non-positive frequency', () => {
    expect(freqToCents(0)).toBeNull();
    expect(freqToCents(-10)).toBeNull();
  });
});
