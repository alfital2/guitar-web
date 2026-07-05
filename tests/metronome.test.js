// tests/metronome.test.js
import { describe, it, expect } from 'vitest';
import { secondsPerBeat, clampTempo, createMetronome, tapToBpm } from '../src/metronome.js';

describe('tapToBpm (tap tempo)', () => {
  const at = (bpm, n) => Array.from({ length: n }, (_, i) => i * (60000 / bpm));
  it('needs at least two taps', () => {
    expect(tapToBpm([])).toBeNull();
    expect(tapToBpm([1000])).toBeNull();
  });
  it('derives BPM from even taps', () => {
    expect(tapToBpm(at(120, 4))).toBe(120); // 500ms gaps
    expect(tapToBpm(at(90, 5))).toBe(90);
    expect(tapToBpm(at(150, 6))).toBe(150);
  });
  it('median shrugs off one off-beat tap', () => {
    // four clean 120bpm taps + one very late tap → median interval still 500ms
    const t = [0, 500, 1000, 1500, 3000];
    expect(tapToBpm(t)).toBe(120);
  });
  it('only the last `window` taps count (adapts to a tempo change)', () => {
    // slow taps then a run of fast ones; the recent window wins
    const slow = [0, 1000, 2000];           // 60 bpm
    const fast = [2000, 2400, 2800, 3200, 3600]; // 150 bpm
    expect(tapToBpm([...slow, ...fast.slice(1)], { window: 4 })).toBe(150);
  });
  it('clamps to the metronome range', () => {
    expect(tapToBpm([0, 100])).toBe(240);   // 600 bpm → clamped
    expect(tapToBpm([0, 5000])).toBe(40);   // 12 bpm → clamped
  });
});

describe('tempo helpers', () => {
  it('secondsPerBeat', () => {
    expect(secondsPerBeat(120)).toBeCloseTo(0.5);
    expect(secondsPerBeat(60)).toBeCloseTo(1);
  });
  it('clampTempo bounds and rounds', () => {
    expect(clampTempo(20)).toBe(40);
    expect(clampTempo(999)).toBe(240);
    expect(clampTempo(119.6)).toBe(120);
    expect(clampTempo(NaN)).toBe(120);
  });
});

describe('createMetronome (no audio)', () => {
  it('tracks tempo and running state', () => {
    const m = createMetronome();
    expect(m.getTempo()).toBe(120);
    m.setTempo(8000); expect(m.getTempo()).toBe(240);
    expect(m.isRunning()).toBe(false);
    m.start(); expect(m.isRunning()).toBe(true);
    m.toggle(); expect(m.isRunning()).toBe(false);
  });
  it('armRecord fires the downbeat immediately when there is no audio', () => {
    const m = createMetronome();
    let down = false;
    m.armRecord({ countBeats: 4, recordMetro: false, onDownbeat: () => { down = true; } });
    expect(down).toBe(true); // no AudioContext → synchronous downbeat
  });
});
