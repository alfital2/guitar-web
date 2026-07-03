// tests/clip-ops.test.js
import { describe, it, expect } from 'vitest';
import { cloneTake, splitTakeAt, resolveNoOverlap, clampRepeat } from '../src/clip-ops.js';

const take = (over = {}) => ({ n: 1, x: 0, name: 'A', sampleRate: 100, duration: 1, offset: 0, len: 1, samples: new Float32Array(100).map((_, i) => i), ...over });

describe('cloneTake', () => {
  it('carries offset/len/duration and shares the (immutable) samples buffer', () => {
    const t = take({ x: 32, offset: 0.25, len: 0.5 });
    const c = cloneTake(t);
    expect(c.offset).toBe(0.25); expect(c.len).toBe(0.5); expect(c.duration).toBe(1);
    expect(c.x).toBe(32); expect(c.name).toBe('A'); expect(c.sampleRate).toBe(100);
    expect(c.samples).toBe(t.samples); // shared: buffers are never mutated in place
  });
  it('carries the loop repeat', () => {
    expect(cloneTake(take({ repeat: 2.5 })).repeat).toBe(2.5);
    expect(cloneTake(take()).repeat).toBeUndefined(); // absent stays absent (defaults to 1)
  });
});

describe('splitTakeAt', () => {
  it('splits an untrimmed take into two windows over the SAME samples', () => {
    const t = take(); // offset 0, len = duration = 1
    const [left, right] = splitTakeAt(t, 0.5, 2, 32);
    expect(left.n).toBe(1); expect(left.x).toBe(0); expect(left.offset).toBe(0);
    expect(left.len).toBeCloseTo(0.5); expect(left.duration).toBe(1);
    expect(right.n).toBe(2); expect(right.offset).toBeCloseTo(0.5); expect(right.len).toBeCloseTo(0.5);
    expect(right.x).toBe(16); // 0.5s * 32 px/s
    expect(left.samples).toBe(t.samples); // window split: no sample copying
    expect(right.samples).toBe(t.samples);
  });
  it('splits an already-trimmed take (offset>0) at the correct absolute position', () => {
    // visible window = 0.5s..1.5s of a 2s buffer, sitting at x=32
    const t = take({ x: 32, duration: 2, offset: 0.5, len: 1, samples: new Float32Array(200) });
    const [left, right] = splitTakeAt(t, 0.4, 7, 32);
    // left keeps its origin and offset; only the visible length shrinks
    expect(left.x).toBe(32); expect(left.offset).toBe(0.5); expect(left.len).toBeCloseTo(0.4);
    // right continues at the absolute position offset+splitSec into the buffer
    expect(right.n).toBe(7);
    expect(right.offset).toBeCloseTo(0.9); expect(right.len).toBeCloseTo(0.6);
    expect(right.x).toBe(32 + Math.round(0.4 * 32));
    expect(right.duration).toBe(2); // full-buffer duration is preserved
    expect(left.samples).toBe(t.samples); expect(right.samples).toBe(t.samples);
  });
  it('falls back to duration when a legacy take has no len', () => {
    const t = take(); delete t.len; delete t.offset;
    const [left, right] = splitTakeAt(t, 0.5, 2, 32);
    expect(left.len).toBeCloseTo(0.5);
    expect(right.offset).toBeCloseTo(0.5); expect(right.len).toBeCloseTo(0.5);
  });
  it('rejects splits outside the visible window (50ms margin)', () => {
    expect(splitTakeAt(take(), 0, 2, 32)).toBeNull();
    expect(splitTakeAt(take(), 0.05, 2, 32)).toBeNull();
    expect(splitTakeAt(take(), 0.96, 2, 32)).toBeNull();
    expect(splitTakeAt(take(), 1.5, 2, 32)).toBeNull();
    // trimmed take: len (1s) bounds the split, not duration (2s)
    const trimmed = take({ duration: 2, offset: 0.5, len: 1, samples: new Float32Array(200) });
    expect(splitTakeAt(trimmed, 1.2, 2, 32)).toBeNull();
    expect(splitTakeAt(trimmed, NaN, 2, 32)).toBeNull();
  });
  it('rejects looped takes (v1: a mid-window head-cut is not representable)', () => {
    expect(splitTakeAt(take({ repeat: 2 }), 0.5, 2, 32)).toBeNull();
    expect(splitTakeAt(take({ repeat: 1.5 }), 0.5, 2, 32)).toBeNull();
    // repeat 1 (or absent) still splits normally
    expect(splitTakeAt(take({ repeat: 1 }), 0.5, 2, 32)).toHaveLength(2);
  });
});

describe('clampRepeat (loop vs the next clip)', () => {
  // px/sec = 32 in these cases; the clip sits at x=0 with a 1s window.
  it('passes the repeat through when nothing is to the right', () => {
    expect(clampRepeat([], 0, 1, 2.5, 32)).toBe(2.5);
    expect(clampRepeat([{ x: 0, w: 32 }], 64, 1, 3, 32)).toBe(3); // left neighbor ignored
  });
  it('clamps so the looped span stops at the next clip', () => {
    expect(clampRepeat([{ x: 96, w: 64 }], 0, 1, 5, 32)).toBe(3);   // 96px = 3s = 3 windows
    expect(clampRepeat([{ x: 96, w: 64 }], 0, 1, 2, 32)).toBe(2);   // under the limit → untouched
  });
  it('collapses to exactly 1 below ~1.05 (drag snap-back and tight neighbors)', () => {
    expect(clampRepeat([], 0, 1, 1.02, 32)).toBe(1);
    expect(clampRepeat([{ x: 33, w: 64 }], 0, 1, 4, 32)).toBe(1); // neighbor leaves < 1.05 windows
    expect(clampRepeat([], 0, 1, 0.4, 32)).toBe(1);               // never below 1
  });
});

describe('resolveNoOverlap', () => {
  it('keeps the desired x when it does not overlap', () => {
    expect(resolveNoOverlap([{ x: 0, w: 64 }], 100, 50)).toBe(100);
  });
  it('pushes to the nearest free edge when overlapping', () => {
    // desired 30 over a clip at [0,64] → snaps to 64 (right edge, nearest valid)
    expect(resolveNoOverlap([{ x: 0, w: 64 }], 30, 50)).toBe(64);
  });
  it('clamps to >= 0', () => {
    expect(resolveNoOverlap([], -20, 50)).toBe(0);
  });
  it('appends at the end when no candidate fits', () => {
    // two clips tightly packed; a wide clip can only go after them
    const x = resolveNoOverlap([{ x: 0, w: 64 }, { x: 64, w: 64 }], 10, 100);
    expect(x).toBe(128);
  });
});
