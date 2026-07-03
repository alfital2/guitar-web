// tests/player.test.js
import { describe, it, expect } from 'vitest';
import { playbackDuration, takeSchedule, createPlayer } from '../src/player.js';
// PX_PER_SEC = 32 (1 bar = 64px @ 120 BPM 4/4 = 2s)

describe('playbackDuration', () => {
  it('empty → 0', () => {
    expect(playbackDuration([])).toBe(0);
  });
  it('single take at x=0 → its duration', () => {
    expect(playbackDuration([{ x: 0, duration: 2 }])).toBeCloseTo(2);
  });
  it('accounts for each take offset (x/PX_PER_SEC + duration)', () => {
    expect(playbackDuration([{ x: 0, duration: 2 }, { x: 64, duration: 1 }])).toBeCloseTo(3);
  });
  it('uses the trimmed len when present (not the full duration)', () => {
    expect(playbackDuration([{ x: 0, duration: 4, len: 1.5 }])).toBeCloseTo(1.5);
    expect(playbackDuration([{ x: 64, duration: 4, len: 1 }])).toBeCloseTo(3); // 64px=2s + len 1
  });
  it('a looped take spans len * repeat (fractional tail included)', () => {
    expect(playbackDuration([{ x: 0, duration: 4, len: 1, repeat: 2.5 }])).toBeCloseTo(2.5);
    expect(playbackDuration([{ x: 64, duration: 1, len: 1, repeat: 3 }])).toBeCloseTo(5);
    expect(playbackDuration([{ x: 0, duration: 2, repeat: 2 }])).toBeCloseTo(4); // legacy: no len
    expect(playbackDuration([{ x: 0, duration: 2, len: 1, repeat: 1 }])).toBeCloseTo(1); // repeat 1 = no loop
  });
});

// takeSchedule maps a take to the buffer-source windows to start: one entry
// per (partial) repetition still ahead of fromSec.
describe('takeSchedule', () => {
  it('plain take → one window at its timeline position', () => {
    expect(takeSchedule({ x: 64, offset: 0.5, len: 1, duration: 4 }, 0))
      .toEqual([{ when: 2, offset: 0.5, dur: 1 }]);
  });
  it('mid-clip start skips further into the window (existing semantics)', () => {
    expect(takeSchedule({ x: 0, offset: 0.5, len: 2, duration: 4 }, 0.75))
      .toEqual([{ when: 0, offset: 1.25, dur: 1.25 }]);
  });
  it('looped take → one window per repetition, final one truncated to the fraction', () => {
    expect(takeSchedule({ x: 0, offset: 0, len: 1, duration: 1, repeat: 2.5 }, 0)).toEqual([
      { when: 0, offset: 0, dur: 1 },
      { when: 1, offset: 0, dur: 1 },
      { when: 2, offset: 0, dur: 0.5 },
    ]);
  });
  it('a start inside repetition k begins that repetition mid-window', () => {
    const w = takeSchedule({ x: 0, offset: 0, len: 1, duration: 1, repeat: 2.5 }, 1.25);
    expect(w).toHaveLength(2);                       // repetition 0 already passed
    expect(w[0].when).toBe(0);
    expect(w[0].offset).toBeCloseTo(0.25);           // 0.25s into repetition 1
    expect(w[0].dur).toBeCloseTo(0.75);
    expect(w[1]).toEqual({ when: 0.75, offset: 0, dur: 0.5 });
  });
  it('respects the trim offset in every repetition', () => {
    expect(takeSchedule({ x: 32, offset: 0.5, len: 1, duration: 2, repeat: 2 }, 0)).toEqual([
      { when: 1, offset: 0.5, dur: 1 },
      { when: 2, offset: 0.5, dur: 1 },
    ]);
  });
  it('empty when playback starts past the looped span', () => {
    expect(takeSchedule({ x: 0, offset: 0, len: 1, duration: 1, repeat: 2 }, 2.5)).toEqual([]);
    expect(takeSchedule({ x: 0, offset: 0, len: 0, duration: 0 }, 0)).toEqual([]);
  });
});

describe('createPlayer (no audio)', () => {
  it('play is a no-op without AudioContext', () => {
    const p = createPlayer();
    p.play([{ id: 1, gain: 1, pan: 0, takes: [{ x: 0, duration: 2, samples: new Float32Array(8), sampleRate: 8 }] }], 0, () => {}, () => {});
    expect(p.isPlaying()).toBe(false);
  });
});
