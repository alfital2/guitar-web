// tests/profile-attributes.test.js
import { describe, it, expect } from 'vitest';
import { STAT_ORDER, fingerprintToStats, archetype } from '../src/profile-card/attributes.js';

const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe('fingerprintToStats', () => {
  it('flat fingerprint -> all stats 50', () => {
    const s = fingerprintToStats(flat);
    expect(STAT_ORDER.map(k => s[k])).toEqual([50, 50, 50, 50, 50, 50]);
  });
  it('+10 dB band -> that stat 100, clamps', () => {
    const fp = [0, 0, 0, 0, 0, 0, 0, 0, 0, 12];
    expect(fingerprintToStats(fp).air).toBe(100);
  });
});

describe('archetype', () => {
  it('near-neutral -> Balanced', () => {
    expect(archetype(fingerprintToStats(flat))).toBe('Balanced');
  });
  it('treble-heavy -> Bright & Glassy', () => {
    const fp = [-4, -4, -2, -2, 0, 0, 2, 4, 6, 8];
    expect(archetype(fingerprintToStats(fp))).toBe('Bright & Glassy');
  });
  it('bass-heavy -> Warm & Dark', () => {
    const fp = [8, 6, 4, 2, 0, 0, -2, -4, -6, -8];
    expect(archetype(fingerprintToStats(fp))).toBe('Warm & Dark');
  });
});
