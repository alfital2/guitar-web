// tests/calibration-bands.test.js
import { describe, it, expect } from 'vitest';
import { BANDS, bandEdges, bandIndexFor, bandPowersFromMagnitudes } from '../src/calibration/bands.js';

describe('BANDS', () => {
  it('has 10 ascending centers from 80 to 8000', () => {
    expect(BANDS).toHaveLength(10);
    expect(BANDS[0]).toBe(80);
    expect(BANDS[9]).toBe(8000);
    for (let i = 1; i < BANDS.length; i++) expect(BANDS[i]).toBeGreaterThan(BANDS[i - 1]);
  });
});

describe('bandEdges / bandIndexFor', () => {
  const edges = bandEdges(BANDS);
  it('produces N+1 ascending edges', () => {
    expect(edges).toHaveLength(11);
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThan(edges[i - 1]);
  });
  it('maps a center frequency into its own band', () => {
    expect(bandIndexFor(80, edges)).toBe(0);
    expect(bandIndexFor(1033, edges)).toBe(5);
    expect(bandIndexFor(8000, edges)).toBe(9);
  });
  it('returns -1 below/above the range', () => {
    expect(bandIndexFor(1, edges)).toBe(-1);
    expect(bandIndexFor(50000, edges)).toBe(-1);
  });
});

describe('bandPowersFromMagnitudes', () => {
  it('puts a tone in the correct band', () => {
    const mags = new Float32Array(512);
    const targetBin = Math.round(1033 / (48000 / 1024));
    mags[targetBin] = 10;
    const powers = bandPowersFromMagnitudes(mags, 48000);
    const maxBand = powers.indexOf(Math.max(...powers));
    expect(maxBand).toBe(5);
  });
});
