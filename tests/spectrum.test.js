// tests/spectrum.test.js
import { describe, it, expect } from 'vitest';
import { spectrumBars } from '../src/spectrum.js';

describe('spectrumBars', () => {
  it('returns numBars values', () => {
    expect(spectrumBars(new Uint8Array(256), 16)).toHaveLength(16);
  });
  it('all-max input -> all bars 1.0', () => {
    const bars = spectrumBars(new Uint8Array(256).fill(255), 8);
    bars.forEach(b => expect(b).toBeCloseTo(1));
  });
  it('energy only in the low half -> low bars hot, high bars cold', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 128; i++) bytes[i] = 255;
    const bars = spectrumBars(bytes, 8);
    expect(bars[0]).toBeCloseTo(1);
    expect(bars[7]).toBeCloseTo(0);
  });
});
