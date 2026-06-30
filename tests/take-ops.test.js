// tests/take-ops.test.js
import { describe, it, expect } from 'vitest';
import { punchTakes } from '../src/take-ops.js';
// PX_PER_SEC = 32 → 1s = 32px.

const mk = (n, startSec, dur) => ({ n, x: startSec * 32, duration: dur, samples: new Float32Array(2), sampleRate: 8 });

describe('punchTakes (record overwrite)', () => {
  it('leaves non-overlapping takes untouched', () => {
    const { takes } = punchTakes([mk(1, 0, 1)], 2, 3, 5);
    expect(takes).toHaveLength(1);
    expect(takes[0].n).toBe(1);
  });
  it('drops a take fully covered by the new region', () => {
    const { takes } = punchTakes([mk(1, 1, 1)], 0, 3, 5); // existing [1,2] inside new [0,3]
    expect(takes).toHaveLength(0);
  });
  it('trims the right of a take overlapped on its tail', () => {
    const { takes } = punchTakes([mk(1, 0, 2)], 1, 3, 5); // existing [0,2], new [1,3]
    expect(takes).toHaveLength(1);
    expect(takes[0].len).toBeCloseTo(1);      // [0,1] kept
    expect(takes[0].offset || 0).toBe(0);
  });
  it('trims the left of a take overlapped on its head (offset + x move in)', () => {
    const { takes } = punchTakes([mk(1, 1, 2)], 0, 2, 5); // existing [1,3], new [0,2]
    expect(takes).toHaveLength(1);
    expect(takes[0].len).toBeCloseTo(1);      // [2,3] kept
    expect(takes[0].offset).toBeCloseTo(1);   // skipped 1s into the samples
    expect(takes[0].x).toBe(64);              // starts at 2s = 64px
  });
  it('splits a take when the new region lands inside it', () => {
    const { takes, nextN } = punchTakes([mk(1, 0, 4)], 1, 2, 9); // existing [0,4], new [1,2]
    expect(takes).toHaveLength(2);
    expect(takes[0].len).toBeCloseTo(1);      // left [0,1]
    expect(takes[1].n).toBe(9);               // right piece gets a fresh n
    expect(takes[1].offset).toBeCloseTo(2);
    expect(takes[1].len).toBeCloseTo(2);      // right [2,4]
    expect(takes[1].x).toBe(64);
    expect(nextN).toBe(10);
  });
});
