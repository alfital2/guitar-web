// tests/mpm.test.js
import { describe, it, expect } from 'vitest';
import { detectPitchMPM } from '../src/pitch/mpm.js';

const SR = 44100;
function sine(freq, n = 4096, sr = SR, harmonics = []) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = Math.sin(2 * Math.PI * freq * i / sr);
    for (const [mult, amp] of harmonics) s += amp * Math.sin(2 * Math.PI * freq * mult * i / sr);
    b[i] = s * 0.5;
  }
  return b;
}

describe('detectPitchMPM', () => {
  for (const f of [82.41, 110, 146.83, 220, 440]) {
    it(`detects ${f} Hz within 0.5 Hz`, () => {
      const r = detectPitchMPM(sine(f), SR);
      expect(r).not.toBeNull();
      expect(Math.abs(r.freq - f)).toBeLessThan(0.5);
    });
  }
  it('returns the fundamental even with a strong 2nd harmonic', () => {
    const r = detectPitchMPM(sine(110, 4096, SR, [[2, 0.8]]), SR);
    expect(Math.abs(r.freq - 110)).toBeLessThan(1);
  });
  it('returns null for white noise', () => {
    const b = new Float32Array(4096);
    let seed = 7;
    for (let i = 0; i < b.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; b[i] = (seed / 0x7fffffff) * 2 - 1; }
    expect(detectPitchMPM(b, SR)).toBeNull();
  });
  it('returns null for silence', () => {
    expect(detectPitchMPM(new Float32Array(4096), SR)).toBeNull();
  });
  it('reports high clarity for a clean sine', () => {
    expect(detectPitchMPM(sine(220), SR).clarity).toBeGreaterThan(0.9);
  });
});
