import { describe, it, expect } from 'vitest';
import {
  createNoteTracker, createNoteTracker2, createOnsetDetector,
  assignFret, positionsFor, quantizeToGrid, freqToMidiFloat, TUNING_MIDI,
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

// ── v2: onset-driven tracker ────────────────────────────────────────────────
// tick helper: one push in tracker2 shape (8 ms hop).
function ticks2(tr, freq, n, t0, { onsetFirst = false, dt = 0.008, clarity = 0.95, rms = 0.05 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(...tr.push({ freq, clarity, rms, tSec: t0 + i * dt, onset: onsetFirst && i === 0 }));
  }
  return out;
}

describe('createOnsetDetector', () => {
  it('fires on an attack rising from silence', () => {
    const od = createOnsetDetector();
    let fired = 0;
    for (let i = 0; i < 20; i++) if (od.push(0.001, i * 0.008)) fired++;
    expect(fired).toBe(0);
    expect(od.push(0.08, 0.2)).toBe(true);         // attack
    expect(od.push(0.07, 0.208)).toBe(false);      // sustain — no retrigger
  });
  it('fires again on a repick over a decaying sustain', () => {
    const od = createOnsetDetector();
    od.push(0.001, 0);
    expect(od.push(0.09, 0.008)).toBe(true);       // first pick
    let t = 0.016, lvl = 0.09;
    for (let i = 0; i < 30; i++) { od.push(lvl *= 0.93, t); t += 0.008; } // decay ~0.01
    expect(od.push(0.09, t)).toBe(true);           // repick punches through
  });
  it('refractory blocks double-fires inside one attack', () => {
    const od = createOnsetDetector({ refractorySec: 0.055 });
    od.push(0.001, 0);
    expect(od.push(0.05, 0.008)).toBe(true);
    expect(od.push(0.12, 0.016)).toBe(false);      // still the same attack
  });
});

describe('createNoteTracker2 (onset-driven)', () => {
  it('same-pitch REPICK yields two separate notes (the v1 blind spot)', () => {
    const tr = createNoteTracker2({ voteTicks: 4 });
    const ev1 = ticks2(tr, A2, 8, 0, { onsetFirst: true });
    const ev2 = ticks2(tr, A2, 8, 0.25, { onsetFirst: true });   // repicked SAME note
    const ons = [...ev1, ...ev2].filter((e) => e.type === 'on');
    expect(ons.length).toBe(2);
    expect(ons.map((e) => e.midi)).toEqual([45, 45]);
    expect(ons[1].tSec).toBeCloseTo(0.25, 5);      // stamped at the onset
  });
  it('fast consecutive different notes both land, stamped at their onsets', () => {
    const tr = createNoteTracker2({ voteTicks: 4 });
    const ev1 = ticks2(tr, A2, 6, 0, { onsetFirst: true });
    const ev2 = ticks2(tr, C3, 6, 0.12, { onsetFirst: true });   // 120 ms later (fast 16ths)
    const ons = [...ev1, ...ev2].filter((e) => e.type === 'on');
    expect(ons.map((e) => e.midi)).toEqual([45, 48]);
    expect(ons[1].tSec).toBeCloseTo(0.12, 5);
  });
  it('vote survives noisy attack frames (median wins)', () => {
    const tr = createNoteTracker2({ voteTicks: 5 });
    const out = [];
    // attack frame reads garbage (octave error), then settles on A2
    out.push(...tr.push({ freq: A2 * 2, clarity: 0.9, rms: 0.09, tSec: 0, onset: true }));
    for (let i = 1; i < 6; i++) out.push(...tr.push({ freq: A2, clarity: 0.95, rms: 0.06, tSec: i * 0.008 }));
    const ons = out.filter((e) => e.type === 'on');
    expect(ons.length).toBe(1);
    expect(ons[0].midi).toBe(45);                  // median beat the octave glitch
  });
  it('noise onset with no pitch evaporates (no ghost notes)', () => {
    const tr = createNoteTracker2({ voteTicks: 5, voteTimeoutSec: 0.05 });
    const out = [];
    out.push(...tr.push({ freq: null, clarity: 0, rms: 0.09, tSec: 0, onset: true })); // thump
    for (let i = 1; i < 12; i++) out.push(...tr.push({ freq: null, clarity: 0, rms: 0.002, tSec: i * 0.008 }));
    expect(out.filter((e) => e.type === 'on').length).toBe(0);
  });
  it('legato (pitch jump, NO onset) still retriggers', () => {
    const tr = createNoteTracker2({ voteTicks: 4, jumpTicks: 3 });
    ticks2(tr, A2, 6, 0, { onsetFirst: true });
    const ev = ticks2(tr, C3, 5, 0.2);             // hammer-on: no attack spike
    const ons = ev.filter((e) => e.type === 'on');
    expect(ons.length).toBe(1);
    expect(ons[0].midi).toBe(48);
  });
  it('silence releases the active note', () => {
    const tr = createNoteTracker2({ voteTicks: 4, offTicks: 5 });
    ticks2(tr, A2, 6, 0, { onsetFirst: true });
    const ev = ticks2(tr, null, 6, 0.3, { clarity: 0, rms: 0 });
    expect(ev[ev.length - 1]).toMatchObject({ type: 'off', midi: 45 });
  });
  it('end() flushes and resets vote state', () => {
    const tr = createNoteTracker2({ voteTicks: 4 });
    ticks2(tr, A2, 6, 0, { onsetFirst: true });
    expect(tr.end(1)).toEqual([{ type: 'off', midi: 45, tSec: 1 }]);
    expect(tr.end(2)).toEqual([]);
  });
});
