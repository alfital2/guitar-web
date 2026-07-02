import { describe, it, expect } from 'vitest';
import { mapRange, dbToGain, makeSoftClipCurve, makeReverbImpulse,
  makeRectifierCurve, makeDistortionCurve, makeSpringImpulse } from '../src/dsp.js';
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

describe('makeRectifierCurve', () => {
  // A WaveShaper interpolates x=0 between the two center samples of an
  // even-length curve, so "silence maps to silence" means their midpoint is
  // ~0. The old curve's midpoint was -depth (a DC hum during silence — probe
  // report 2026-07-01, octave gapRms ≈ 0.28).
  it('passes through the origin for every depth (silence stays silent)', () => {
    for (const depth of [0, 0.3, 0.7, 1]) {
      const c = makeRectifierCurve(depth);
      const mid = (c[1023] + c[1024]) / 2;
      expect(Math.abs(mid)).toBeLessThan(1e-3);
    }
  });
  it('keeps the rectify shape: even-symmetric at depth 1, endpoints preserved', () => {
    const c = makeRectifierCurve(1);
    expect(c[0]).toBeCloseTo(1, 5);            // f(-1) = |-1| = 1
    expect(c[c.length - 1]).toBeCloseTo(1, 5); // f(+1) = 1
    for (const i of [0, 200, 512, 900]) expect(c[i]).toBeCloseTo(c[c.length - 1 - i], 5);
  });
  it('blends toward identity as depth falls', () => {
    const c = makeRectifierCurve(0);
    expect(c[0]).toBeCloseTo(-1, 5);
    expect(c[c.length - 1]).toBeCloseTo(1, 5);
  });
});

describe('makeDistortionCurve', () => {
  const c = makeDistortionCurve(6, 2048);
  it('has requested length and stays in [-1,1]', () => {
    expect(c.length).toBe(2048);
    expect(Math.max(...c)).toBeLessThanOrEqual(1);
    expect(Math.min(...c)).toBeGreaterThanOrEqual(-1);
  });
  it('is monotonic non-decreasing and passes through the origin', () => {
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(Math.abs((c[1023] + c[1024]) / 2)).toBeLessThan(1e-3);
  });
  it('more dist = steeper near the zero crossing', () => {
    const lo = makeDistortionCurve(1), hi = makeDistortionCurve(9);
    expect(hi[1024 + 20]).toBeGreaterThan(lo[1024 + 20]);
  });
});

describe('makeSpringImpulse', () => {
  const ctx = new FakeAudioContext(48000);
  const buf = makeSpringImpulse(ctx, 1.0, 0.06, 2);
  it('builds a stereo buffer of the right length', () => {
    expect(buf.length).toBe(48000);
    expect(buf.numberOfChannels).toBe(2);
  });
  it('drip train: energy peaks at the drip spacing, quieter between drips', () => {
    const d = buf.getChannelData(0);
    const rms = (t0, t1) => {
      const i0 = Math.round(t0 * 48000), i1 = Math.round(t1 * 48000);
      let s = 0; for (let i = i0; i < i1; i++) s += d[i] * d[i];
      return Math.sqrt(s / (i1 - i0));
    };
    // 2nd drip fires at t=0.06 and chirps for ~25ms; between-drip window
    // [0.095, 0.115] holds only the noise bed.
    expect(rms(0.06, 0.085)).toBeGreaterThan(rms(0.095, 0.115) * 1.5);
  });
});
