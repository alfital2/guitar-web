// tests/profile-attributes.test.js
import { describe, it, expect } from 'vitest';
import { STAT_ORDER, fingerprintToStats, archetype } from '../src/profile-card/attributes.js';

// A fingerprint matching the "typical electric guitar" reference shape -> all stats ~50.
const typical = [4, 4, 4, 4, 2, 2, -2, -6, -6, -10];
const flat = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe('fingerprintToStats', () => {
  it('typical-guitar fingerprint -> all stats 50', () => {
    const s = fingerprintToStats(typical);
    expect(STAT_ORDER.map(k => s[k])).toEqual([50, 50, 50, 50, 50, 50]);
  });
  it('flat spectrum reads brighter/airier than a typical guitar', () => {
    const s = fingerprintToStats(flat);
    expect(s.air).toBeGreaterThan(50);        // flat has more top end than typical
    expect(s.brightness).toBeGreaterThan(50);
    expect(s.body).toBeLessThan(50);          // ...and less low-end weight
  });
  it('Air is no longer pinned at 0 for a normal-ish guitar', () => {
    const s = fingerprintToStats(typical);
    expect(s.air).toBe(50);
  });
});

describe('archetype', () => {
  it('typical guitar -> Balanced', () => {
    expect(archetype(fingerprintToStats(typical))).toBe('Balanced');
  });
  it('brighter-than-typical -> Bright & Glassy', () => {
    const fp = [0, 0, 0, 0, 2, 2, 2, 2, 4, 4];
    expect(archetype(fingerprintToStats(fp))).toBe('Bright & Glassy');
  });
  it('darker-than-typical -> Warm & Dark', () => {
    const fp = [10, 10, 8, 8, 2, 2, -6, -12, -12, -16];
    expect(archetype(fingerprintToStats(fp))).toBe('Warm & Dark');
  });
});
