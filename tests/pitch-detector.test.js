// tests/pitch-detector.test.js
import { describe, it, expect } from 'vitest';
import { autoCorrelate } from '../src/pitch/detector.js';

function sine(freq, sampleRate, n, amp = 1) {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin(2 * Math.PI * freq * i / sampleRate);
  return buf;
}

describe('autoCorrelate', () => {
  it('detects 440 Hz within a few Hz', () => {
    const f = autoCorrelate(sine(440, 48000, 2048), 48000);
    expect(Math.abs(f - 440)).toBeLessThan(5);
  });
  it('detects low E (82.41 Hz)', () => {
    const f = autoCorrelate(sine(82.41, 48000, 2048), 48000);
    expect(Math.abs(f - 82.41)).toBeLessThan(4);
  });
  it('returns -1 for silence', () => {
    expect(autoCorrelate(new Float32Array(2048), 48000)).toBe(-1);
  });
  it('detects a quiet note (low amplitude) above the lowered gate', () => {
    const f = autoCorrelate(sine(440, 48000, 2048, 0.03), 48000);
    expect(Math.abs(f - 440)).toBeLessThan(5);
  });
  it('rejects sub-guitar-range hum (60 Hz) as out of range', () => {
    expect(autoCorrelate(sine(60, 48000, 2048), 48000)).toBe(-1);
  });
});
