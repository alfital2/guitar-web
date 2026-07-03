import { describe, it, expect } from 'vitest';
import {
  createNoteTracker, assignFret, positionsFor, quantizeToGrid, freqToMidiFloat, TUNING_MIDI,
} from '../src/tab/transcribe.js';

const A2 = 110, C3 = 130.81, E2 = 82.41, G3 = 196;

// Helper: push n identical frames, collect events.
function frames(tr, freq, n, t0, dt = 0.016, clarity = 0.95, rms = 0.05) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...tr.push(freq, clarity, rms, t0 + i * dt));
  return out;
}

describe('createNoteTracker', () => {
  it('starts a note only after onFrames agreeing frames', () => {
    const tr = createNoteTracker({ onFrames: 3 });
    expect(frames(tr, A2, 2, 0)).toEqual([]);           // not yet
    const ev = frames(tr, A2, 1, 0.032);
    expect(ev).toEqual([{ type: 'on', midi: 45, tSec: 0 }]); // A2 = midi 45, onset at first frame
  });
  it('ends a note after offFrames of silence', () => {
    const tr = createNoteTracker({ onFrames: 3, offFrames: 5 });
    frames(tr, A2, 3, 0);
    const ev = frames(tr, null, 5, 0.1);
    expect(ev[ev.length - 1]).toMatchObject({ type: 'off', midi: 45 });
  });
  it('retriggers on a pitch change with NO silence (hammer-on)', () => {
    const tr = createNoteTracker({ onFrames: 3 });
    frames(tr, A2, 3, 0);
    const ev = frames(tr, C3, 3, 0.2);
    expect(ev.map((e) => e.type)).toEqual(['off', 'on']);
    expect(ev[1].midi).toBe(48); // C3
  });
  it('gates out quiet/unclear frames', () => {
    const tr = createNoteTracker({ onFrames: 3 });
    for (let i = 0; i < 10; i++) expect(tr.push(A2, 0.5, 0.05, i * 0.016)).toEqual([]); // low clarity
    for (let i = 0; i < 10; i++) expect(tr.push(A2, 0.95, 0.001, i * 0.016)).toEqual([]); // below gate
  });
  it('end() flushes a dangling note', () => {
    const tr = createNoteTracker({ onFrames: 3 });
    frames(tr, A2, 3, 0);
    expect(tr.end(1)).toEqual([{ type: 'off', midi: 45, tSec: 1 }]);
  });
});

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
