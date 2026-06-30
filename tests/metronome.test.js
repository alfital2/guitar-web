// tests/metronome.test.js
import { describe, it, expect } from 'vitest';
import { secondsPerBeat, clampTempo, createMetronome } from '../src/metronome.js';

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
  it('startSession fires the downbeat immediately when there is no audio', () => {
    const m = createMetronome();
    let down = false;
    m.startSession({ countBeats: 4, recordMetro: false, onDownbeat: () => { down = true; } });
    expect(down).toBe(true); // no AudioContext → synchronous downbeat
  });
});
