import { describe, it, expect } from 'vitest';
import {
  assignFret, positionsFor, quantizeToGrid, freqToMidiFloat, TUNING_MIDI,
  midiForPosition, fretForString, MAX_FRET, tabTimeForTransport,
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

describe('pitch ↔ position (drag between strings preserves pitch)', () => {
  it('midiForPosition is tuning + fret', () => {
    expect(midiForPosition(3, 5)).toBe(55);   // 5th fret D string = G3
    expect(midiForPosition(5, 0)).toBe(40);   // open low E
  });
  it("the user's example: fret 5 on D dragged to G becomes fret 0", () => {
    const midi = midiForPosition(3, 5);        // 55
    expect(fretForString(midi, 2)).toBe(0);    // G string open = 55
  });
  it('round-trips: every playable position maps back to its own fret', () => {
    for (let s = 0; s < TUNING_MIDI.length; s++) {
      for (let f = 0; f <= MAX_FRET; f++) {
        expect(fretForString(midiForPosition(s, f), s)).toBe(f);
      }
    }
  });
  it('rejects a pitch that cannot sit on the target string', () => {
    const lowE = midiForPosition(5, 0);        // 40
    expect(fretForString(lowE, 0)).toBeNull(); // high e open is 64 — 40 is below it
    const high = midiForPosition(0, MAX_FRET); // top of the high e string
    expect(fretForString(high + 1, 0)).toBeNull(); // one past the last fret
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
  it('never returns negative columns', () => {
    expect(quantizeToGrid(-0.2, 120)).toBe(0);
  });
});

describe('tabTimeForTransport (cursor sync)', () => {
  it('maps transport time into the clip window to tab-local time', () => {
    // clip starts at 2 s on the timeline, lasts 3 s
    expect(tabTimeForTransport(2.0, 2, 3)).toBeCloseTo(0, 5);
    expect(tabTimeForTransport(3.5, 2, 3)).toBeCloseTo(1.5, 5);
  });
  it('returns null before the clip and past its end (cursor hidden)', () => {
    expect(tabTimeForTransport(1.0, 2, 3)).toBeNull();   // before
    expect(tabTimeForTransport(5.5, 2, 3)).toBeNull();   // well past end+pad
  });
  it('clamps a hair before the start to 0 (scheduling slop)', () => {
    expect(tabTimeForTransport(1.99, 2, 3)).toBe(0);
  });
});
