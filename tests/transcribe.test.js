import { describe, it, expect } from 'vitest';
import {
  assignFret, positionsFor, quantizeToGrid, freqToMidiFloat, TUNING_MIDI,
} from '../src/tab/transcribe.js';

const G3 = 196;

describe('fret assignment (standard tuning)', () => {
  it('tuning is display-ordered high e → low E', () => {
    expect(TUNING_MIDI).toEqual([64, 59, 55, 50, 45, 40]);
  });
  it('E2 has exactly one position: low E open', () => {
    expect(positionsFor(40)).toEqual([{ string: 5, fret: 0 }]);
  });
  it('with no context, favors open/low positions', () => {
    expect(assignFret(Math.round(freqToMidiFloat(G3)))).toEqual({ string: 2, fret: 0 }); // G3 = open G
  });
  it('with context, stays near the previous position', () => {
    const prev = { string: 5, fret: 12 };                    // playing up at the 12th
    const pos = assignFret(50, prev);                        // D3
    expect(pos.string).toBe(5);                              // low E fret 10, not open D
    expect(pos.fret).toBe(10);
  });
  it('out-of-range notes return null', () => {
    expect(assignFret(20)).toBeNull();   // way below E2
    expect(assignFret(95)).toBeNull();   // above high e fret 17 (81)
  });
});

describe('quantizeToGrid', () => {
  it('maps seconds to 16th columns at the given bpm', () => {
    expect(quantizeToGrid(0, 120)).toBe(0);
    expect(quantizeToGrid(0.5, 120)).toBe(4);    // one beat = 4 sixteenths
    expect(quantizeToGrid(0.51, 120)).toBe(4);   // snaps
    expect(quantizeToGrid(0.44, 120)).toBe(4);
    expect(quantizeToGrid(2, 60)).toBe(8);
  });
  it('never returns negative columns (lag compensation can go below zero)', () => {
    expect(quantizeToGrid(-0.2, 120)).toBe(0);
  });
});
