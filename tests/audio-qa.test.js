// tests/audio-qa.test.js
import { describe, it, expect } from 'vitest';
import { pluck, riff } from '../tools/audio-qa/signal.js';
import { peak, rms, analyze } from '../tools/audio-qa/metrics.js';

const SR = 44100;

describe('signal', () => {
  it('pluck makes a decaying tone', () => {
    const p = pluck(110, SR, 1);
    expect(p.length).toBe(SR);
    expect(peak(p)).toBeGreaterThan(0.2);
    // late energy lower than early (it decays)
    expect(rms(p, SR * 0.8, SR)).toBeLessThan(rms(p, 0, SR * 0.2));
  });
  it('riff has input then a silent tail', () => {
    const r = riff(SR, { tailSec: 4 });
    expect(r.inputEndSec).toBeGreaterThan(1);
    expect(peak(r.samples)).toBeGreaterThan(0.2);
  });
});

describe('analyze verdicts', () => {
  const SR2 = 8000;
  function buf(fn, sec = 8) { const n = SR2 * sec; const b = new Float32Array(n); for (let i = 0; i < n; i++) b[i] = fn(i / SR2, i); return b; }

  it('a decaying tone after the input → ok', () => {
    const b = buf((t) => (t < 2 ? Math.sin(2 * Math.PI * 110 * t) * 0.5 : Math.sin(2 * Math.PI * 110 * t) * 0.5 * Math.exp(-(t - 2) * 4)));
    const r = analyze(b, SR2, { inputEndSec: 2 });
    expect(r.verdict).toBe('ok');
  });
  it('non-decaying tail → endless echo warning', () => {
    const b = buf((t) => Math.sin(2 * Math.PI * 110 * t) * 0.5); // never decays
    const r = analyze(b, SR2, { inputEndSec: 2 });
    expect(r.reasons.join(' ')).toMatch(/endless echo|long tail/);
  });
  it('growing tail → runaway feedback fail', () => {
    const b = buf((t) => Math.sin(2 * Math.PI * 110 * t) * 0.2 * Math.exp((t) * 0.25)); // energy grows
    const r = analyze(b, SR2, { inputEndSec: 2 });
    expect(r.verdict).toBe('fail');
    expect(r.growing).toBe(true);
  });
  it('silence → fail', () => {
    expect(analyze(new Float32Array(SR2 * 8), SR2, { inputEndSec: 2 }).verdict).toBe('fail');
  });
  it('NaN → fail', () => {
    const b = buf((t) => (t < 2 ? 0.3 : NaN));
    expect(analyze(b, SR2, { inputEndSec: 2 }).nonFinite).toBe(true);
  });
  it('clipping → flagged', () => {
    const b = buf((t) => (t < 2 ? 2.0 : 0));
    expect(analyze(b, SR2, { inputEndSec: 2 }).reasons.join(' ')).toMatch(/clipping/);
  });
});
