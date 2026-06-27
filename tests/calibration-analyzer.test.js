// tests/calibration-analyzer.test.js
import { describe, it, expect } from 'vitest';
import { createAccumulator, accumulate, fingerprint, coverage } from '../src/calibration/analyzer.js';

describe('accumulator + fingerprint', () => {
  it('accumulates frames and produces a normalized (mean ~0) fingerprint', () => {
    let s = createAccumulator(4);
    s = accumulate(s, [1, 1, 100, 1], 0.5);
    s = accumulate(s, [1, 1, 100, 1], 0.5);
    const fp = fingerprint(s);
    expect(fp).toHaveLength(4);
    const mean = fp.reduce((a, c) => a + c, 0) / fp.length;
    expect(mean).toBeCloseTo(0, 6);
    expect(fp[2]).toBeGreaterThan(fp[0]);
  });
});

describe('coverage', () => {
  it('is 0 when level gate not met', () => {
    let s = createAccumulator(4);
    s = accumulate(s, [1, 1, 1, 1], 0.0);
    expect(coverage(s, 1).coverage).toBe(0);
  });
  it('rises as bands fill and duration is met', () => {
    let s = createAccumulator(4);
    for (let i = 0; i < 10; i++) s = accumulate(s, [1, 1, 1, 1], 0.5);
    const c = coverage(s, 10);
    expect(c.bandFraction).toBe(1);
    expect(c.durationFraction).toBe(1);
    expect(c.leveled).toBe(true);
    expect(c.coverage).toBe(1);
  });
  it('partial band coverage caps the score', () => {
    let s = createAccumulator(4);
    for (let i = 0; i < 10; i++) s = accumulate(s, [1, 0, 0, 0], 0.5);
    const c = coverage(s, 10);
    expect(c.bandFraction).toBeCloseTo(0.25);
    expect(c.coverage).toBeCloseTo(0.25);
  });
});
