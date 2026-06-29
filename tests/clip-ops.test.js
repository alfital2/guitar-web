// tests/clip-ops.test.js
import { describe, it, expect } from 'vitest';
import { cloneTake, splitTakeAt } from '../src/clip-ops.js';

const take = () => ({ n: 1, x: 0, name: 'A', sampleRate: 100, duration: 1, samples: new Float32Array(100).map((_, i) => i) });

describe('cloneTake', () => {
  it('deep-copies samples (independent buffer)', () => {
    const t = take(); const c = cloneTake(t);
    c.samples[0] = 999;
    expect(t.samples[0]).toBe(0);
    expect(c.duration).toBe(1); expect(c.name).toBe('A');
  });
});

describe('splitTakeAt', () => {
  it('splits at the offset into two takes', () => {
    const [left, right] = splitTakeAt(take(), 0.5, 2, 32);
    expect(left.n).toBe(1); expect(left.samples.length).toBe(50); expect(left.duration).toBeCloseTo(0.5);
    expect(right.n).toBe(2); expect(right.samples.length).toBe(50); expect(right.duration).toBeCloseTo(0.5);
    expect(right.x).toBe(16); // 0.5s * 32 px/s
    expect(Array.from(right.samples.slice(0, 2))).toEqual([50, 51]);
  });
  it('returns null when the offset is outside the clip', () => {
    expect(splitTakeAt(take(), 0, 2, 32)).toBeNull();
    expect(splitTakeAt(take(), 1.5, 2, 32)).toBeNull();
  });
});
