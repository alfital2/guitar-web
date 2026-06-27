// tests/profile-radar.test.js
import { describe, it, expect } from 'vitest';
import { radarPoints } from '../src/profile-card/radar.js';

const full = { body: 100, warmth: 100, mids: 100, presence: 100, brightness: 100, air: 100 };
const zero = { body: 0, warmth: 0, mids: 0, presence: 0, brightness: 0, air: 0 };

describe('radarPoints', () => {
  it('returns 6 points', () => {
    expect(radarPoints(full, 100, 100, 50)).toHaveLength(6);
  });
  it('first axis (body=100) sits at the top (cx, cy-radius)', () => {
    const p = radarPoints(full, 100, 100, 50)[0];
    expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(50);
  });
  it('stat 0 sits at the center', () => {
    const p = radarPoints(zero, 100, 100, 50)[0];
    expect(p.x).toBeCloseTo(100); expect(p.y).toBeCloseTo(100);
  });
});
