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

// Looped takes count their full span (len * repeat); cuts that land mid-window
// flatten into window pieces since one (offset,len,repeat) can't represent a
// loop whose first repetition starts partway through the window.
describe('punchTakes over looped takes', () => {
  const loop = (n, startSec, len, rep) => ({ ...mk(n, startSec, len), len, offset: 0, repeat: rep });

  it('sees the full looped span for overlap (untouched beyond it, dropped inside)', () => {
    const kept = punchTakes([loop(1, 0, 1, 3)], 4, 5, 9).takes;   // span [0,3], punch [4,5]
    expect(kept).toHaveLength(1);
    expect(kept[0].repeat).toBe(3);                               // untouched, loop intact
    expect(punchTakes([loop(1, 0, 1, 3)], 0, 3, 9).takes).toHaveLength(0); // fully covered → drop
  });
  it('punching the tail shrinks the repeat (fractional tail allowed)', () => {
    const { takes } = punchTakes([loop(1, 0, 1, 3)], 2.5, 4, 9);  // span [0,3], punch [2.5,4]
    expect(takes).toHaveLength(1);
    expect(takes[0].len).toBeCloseTo(1);                          // window untouched
    expect(takes[0].repeat).toBeCloseTo(2.5);                     // 3 → 2.5 repetitions
    expect(takes[0].x).toBe(0);
  });
  it('a tail punch below one window collapses the loop into a plain trim', () => {
    const { takes } = punchTakes([loop(1, 0, 1, 2)], 0.6, 3, 9);
    expect(takes).toHaveLength(1);
    expect(takes[0].len).toBeCloseTo(0.6);
    expect(takes[0].repeat).toBe(1);
  });
  it('a head punch on a repetition boundary keeps a clean shorter loop', () => {
    const { takes, nextN } = punchTakes([loop(1, 0, 1, 3)], 0, 1, 9); // cut exactly one repetition
    expect(takes).toHaveLength(1);
    expect(takes[0].n).toBe(1);
    expect(takes[0].offset).toBe(0); expect(takes[0].len).toBeCloseTo(1);
    expect(takes[0].repeat).toBeCloseTo(2);
    expect(takes[0].x).toBe(32);                                  // starts at 1s
    expect(nextN).toBe(9);                                        // no extra pieces needed
  });
  it('a head punch mid-window flattens: partial piece + looped remainder', () => {
    const { takes, nextN } = punchTakes([loop(1, 0, 1, 3.5)], 0, 1.5, 9); // span [0,3.5], cut 1.5
    expect(takes).toHaveLength(2);
    // tail of the interrupted repetition: window [0.5,1) at 1.5s
    expect(takes[0].n).toBe(1);
    expect(takes[0].offset).toBeCloseTo(0.5); expect(takes[0].len).toBeCloseTo(0.5);
    expect(takes[0].repeat).toBe(1); expect(takes[0].x).toBe(48);
    // remaining 1.5 repetitions stay a loop from the window top at 2s
    expect(takes[1].n).toBe(9);
    expect(takes[1].offset).toBe(0); expect(takes[1].len).toBeCloseTo(1);
    expect(takes[1].repeat).toBeCloseTo(1.5); expect(takes[1].x).toBe(64);
    expect(nextN).toBe(10);
  });
  it('a punch inside a loop keeps a looped head and flattens the tail', () => {
    const { takes, nextN } = punchTakes([loop(1, 0, 1, 3)], 1.25, 1.5, 9);
    expect(takes).toHaveLength(3);
    expect(takes[0].n).toBe(1);
    expect(takes[0].repeat).toBeCloseTo(1.25);                    // head: 1.25 repetitions kept
    expect(takes[1].n).toBe(9);                                   // rest of the cut repetition
    expect(takes[1].offset).toBeCloseTo(0.5); expect(takes[1].len).toBeCloseTo(0.5);
    expect(takes[1].x).toBe(48);
    expect(takes[2].n).toBe(10);                                  // final whole repetition
    expect(takes[2].offset).toBe(0); expect(takes[2].len).toBeCloseTo(1);
    expect(takes[2].repeat).toBe(1); expect(takes[2].x).toBe(64);
    expect(nextN).toBe(11);
  });
});

// ── recording-latency compensation ──
import { recordHeadTrimSec } from '../src/take-ops.js';

describe('recordHeadTrimSec', () => {
  it('no backing → monitoring latency only', () => {
    expect(recordHeadTrimSec({ playerT0: null, capStart: 10, baseLatency: 0.005, outputLatency: 0.012 })).toBeCloseTo(0.017, 6);
  });
  it('overdub adds the backing schedule gap (t0 - capStart)', () => {
    expect(recordHeadTrimSec({ playerT0: 10.03, capStart: 10.0, baseLatency: 0.005, outputLatency: 0.012 })).toBeCloseTo(0.047, 6);
  });
  it('backing scheduled before capture start contributes nothing negative', () => {
    expect(recordHeadTrimSec({ playerT0: 9.9, capStart: 10.0, baseLatency: 0.01, outputLatency: 0 })).toBeCloseTo(0.01, 6);
  });
  it('clamps to 120 ms and to ≥ 0, tolerates missing latencies', () => {
    expect(recordHeadTrimSec({ playerT0: 12, capStart: 10 })).toBe(0.12);
    expect(recordHeadTrimSec({})).toBe(0);
    expect(recordHeadTrimSec({ baseLatency: undefined, outputLatency: undefined })).toBe(0);
  });
});
