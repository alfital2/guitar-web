import { describe, it, expect } from 'vitest';
import { mapRange, dbToGain, makeSoftClipCurve, makeReverbImpulse } from '../src/dsp.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('mapRange', () => {
  it('maps linearly', () => { expect(mapRange(5, 0, 10, 0, 100)).toBe(50); });
});
describe('dbToGain', () => {
  it('0 dB is unity', () => { expect(dbToGain(0)).toBeCloseTo(1); });
  it('+6 dB ~ x2', () => { expect(dbToGain(6)).toBeCloseTo(1.995, 2); });
});
describe('makeSoftClipCurve', () => {
  const c = makeSoftClipCurve(5, 2048);
  it('has requested length', () => { expect(c.length).toBe(2048); });
  it('stays in [-1,1]', () => { expect(Math.max(...c)).toBeLessThanOrEqual(1); expect(Math.min(...c)).toBeGreaterThanOrEqual(-1); });
  it('is monotonic non-decreasing', () => {
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
  it('more amount = more gain near zero crossing', () => {
    const lo = makeSoftClipCurve(1), hi = makeSoftClipCurve(9);
    const mid = 1024 + 100; // just right of center
    expect(hi[mid]).toBeGreaterThan(lo[mid]);
  });
});
describe('makeReverbImpulse', () => {
  it('builds a buffer of the right length', () => {
    const ctx = new FakeAudioContext(48000);
    const buf = makeReverbImpulse(ctx, 1.5, 2);
    expect(buf.length).toBe(72000);
    expect(buf.numberOfChannels).toBe(2);
  });
});
