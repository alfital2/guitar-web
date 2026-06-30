// tests/player.test.js
import { describe, it, expect } from 'vitest';
import { playbackDuration, createPlayer } from '../src/player.js';
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
});

describe('createPlayer (no audio)', () => {
  it('play is a no-op without AudioContext', () => {
    const p = createPlayer();
    p.play([{ id: 1, gain: 1, pan: 0, takes: [{ x: 0, duration: 2, samples: new Float32Array(8), sampleRate: 8 }] }], 0, () => {}, () => {});
    expect(p.isPlaying()).toBe(false);
  });
});
