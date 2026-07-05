import { describe, it, expect, vi } from 'vitest';
import {
  PPQ, SIXTEENTH, MAX_FRET, DURATIONS, TUNING_PRESETS,
  barTicks, ticksToSec, secToTicks, midiAt, durTicksFromSec, migrateV1, createTabModel,
} from '../src/tab/tab-model.js';

describe('constants + tick math', () => {
  it('grid resolution: PPQ 12, 16th = 3 ticks, frets to 24', () => {
    expect(PPQ).toBe(12);
    expect(SIXTEENTH).toBe(3);
    expect(MAX_FRET).toBe(24);
    expect(DURATIONS).toEqual([48, 36, 24, 18, 12, 9, 6, 3]);   // no dotted 16th
  });

  it('standard tuning preset is display-ordered high e → low E', () => {
    expect(TUNING_PRESETS.EADGBE.midi).toEqual([64, 59, 55, 50, 45, 40]);
    expect(TUNING_PRESETS.DropD.midi[5]).toBe(38);
    expect(Object.keys(TUNING_PRESETS)).toEqual(['EADGBE', 'DropD', 'Eb', 'DADGAD', 'OpenG']);
  });

  it('barTicks follows the time signature', () => {
    expect(barTicks({ num: 4, den: 4 })).toBe(48);
    expect(barTicks({ num: 3, den: 4 })).toBe(36);
    expect(barTicks({ num: 6, den: 8 })).toBe(36);
    expect(barTicks({ num: 12, den: 16 })).toBe(36);
    expect(barTicks({ num: 5, den: 4 })).toBe(60);
  });

  it('ticks ↔ seconds derive from tempo', () => {
    expect(ticksToSec(12, 120)).toBeCloseTo(0.5, 10);    // one beat at 120
    expect(ticksToSec(48, 60)).toBeCloseTo(4, 10);
    expect(secToTicks(0.5, 120)).toBe(12);
    expect(secToTicks(0.51, 120)).toBe(12);              // rounds to int ticks
    expect(secToTicks(0, 120)).toBe(0);
  });

  it('midiAt derives pitch from tuning + capo + fret', () => {
    const state = { tuning: 'EADGBE', capo: 0 };
    expect(midiAt(state, { string: 3, fret: 5 })).toBe(55);
    expect(midiAt({ tuning: 'DropD', capo: 0 }, { string: 5, fret: 0 })).toBe(38);
    expect(midiAt({ tuning: 'EADGBE', capo: 2 }, { string: 5, fret: 0 })).toBe(42);
  });

  it('durTicksFromSec snaps to the nearest legal duration, floor 16th', () => {
    expect(durTicksFromSec(0.5, 120)).toBe(12);          // exactly a quarter
    expect(durTicksFromSec(0.4, 120)).toBe(9);           // 9.6 ticks → dotted 8th
    expect(durTicksFromSec(0.05, 120)).toBe(3);          // tiny → 16th
    expect(durTicksFromSec(9, 120)).toBe(48);            // huge → whole
    expect(durTicksFromSec(null, 120)).toBe(3);          // absent → 16th
  });
});

describe('createTabModel core ops', () => {
  it('starts empty with sane defaults; init merges', () => {
    const m = createTabModel();
    expect(m.getState()).toEqual({
      version: 2, tempo: 120, timeSig: { num: 4, den: 4 }, tuning: 'EADGBE', capo: 0, notes: [],
    });
    expect(createTabModel({ tempo: 90 }).getState().tempo).toBe(90);
  });

  it('getState is a detached clone — mutating it cannot corrupt the model', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 3, fret: 5 });
    const s = m.getState();
    s.notes[0].fret = 9;
    s.tempo = 999;
    expect(m.getState().notes[0].fret).toBe(5);
    expect(m.getState().tempo).toBe(120);
  });

  it('addNote fills defaults and returns a unique id', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 3, string: 3, fret: 7 });
    expect(a).not.toBe(b);
    expect(m.getState().notes[0]).toEqual({
      id: a, tick: 0, durTicks: 3, string: 3, fret: 5, tech: {}, det: null,
    });
  });

  it('addNote validates: bad tick/string/fret/durTicks → null, no note', () => {
    const m = createTabModel();
    expect(m.addNote({ tick: -3, string: 3, fret: 5 })).toBe(null);
    expect(m.addNote({ tick: 1.5, string: 3, fret: 5 })).toBe(null);   // off-grid
    expect(m.addNote({ tick: 0, string: 6, fret: 5 })).toBe(null);
    expect(m.addNote({ tick: 0, string: 3, fret: 25 })).toBe(null);
    expect(m.addNote({ tick: 0, string: 3, fret: -1 })).toBe(null);
    expect(m.addNote({ tick: 0, string: 3, fret: 5, durTicks: 5 })).toBe(null);
    expect(m.getState().notes).toEqual([]);
  });

  it('addNote REPLACES the occupant of the same (tick,string); chords on other strings stack', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 0, string: 3, fret: 7 });   // same cell → replaces
    const c = m.addNote({ tick: 0, string: 4, fret: 5 });   // chord neighbor → stacks
    const notes = m.getState().notes;
    expect(notes).toHaveLength(2);
    expect(notes.find((n) => n.id === b).fret).toBe(7);
    expect(notes.some((n) => n.id === a)).toBe(false);
    expect(notes.some((n) => n.id === c)).toBe(true);
  });

  it('deleteNotes removes by id and reports the count', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 3, string: 3, fret: 7 });
    expect(m.deleteNotes([a, 99])).toBe(1);
    expect(m.getState().notes.map((n) => n.id)).toEqual([b]);
    expect(m.deleteNotes([])).toBe(0);
  });

  it('moveNote to another string PRESERVES pitch — fret recomputed (the invariant)', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });   // D/5 = midi 55
    expect(m.moveNote(a, { string: 2 })).toBe(true);        // G open = 55
    expect(m.getState().notes[0]).toMatchObject({ string: 2, fret: 0 });
  });

  it('moveNote rejects (false, no-op) when the pitch cannot sit on the target string', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 5, fret: 0 });   // low E open = 40
    expect(m.moveNote(a, { string: 0 })).toBe(false);       // high e open is 64
    expect(m.getState().notes[0]).toMatchObject({ string: 5, fret: 0 });
    const b = m.addNote({ tick: 3, string: 0, fret: 20 });  // e/20 = 84
    expect(m.moveNote(b, { string: 5 })).toBe(false);       // needs fret 44 on low E
  });

  it('moveNote in time takes tick verbatim (caller snaps); combined move works', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    expect(m.moveNote(a, { tick: 24 })).toBe(true);
    expect(m.getState().notes[0].tick).toBe(24);
    expect(m.moveNote(a, { tick: 12, string: 2 })).toBe(true);
    expect(m.getState().notes[0]).toMatchObject({ tick: 12, string: 2, fret: 0 });
    expect(m.moveNote(a, { tick: -3 })).toBe(false);
    expect(m.moveNote(99, { tick: 0 })).toBe(false);
  });

  it('moveNote onto an occupied cell replaces the occupant', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 12, string: 3, fret: 7 });
    expect(m.moveNote(a, { tick: 12 })).toBe(true);
    const notes = m.getState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: a, tick: 12, fret: 5 });
    expect(notes.some((n) => n.id === b)).toBe(false);
  });

  it('setFret changes pitch within 0..24', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    expect(m.setFret(a, 24)).toBe(true);
    expect(m.getState().notes[0].fret).toBe(24);
    expect(m.setFret(a, 25)).toBe(false);
    expect(m.setFret(a, -1)).toBe(false);
    expect(m.setFret(99, 5)).toBe(false);
  });

  it('setTempo/setTimeSig/setTuning/setCapo clamp and validate', () => {
    const m = createTabModel();
    m.setTempo(500);  expect(m.getState().tempo).toBe(300);
    m.setTempo(10);   expect(m.getState().tempo).toBe(30);
    m.setTempo(140);  expect(m.getState().tempo).toBe(140);
    m.setTimeSig(3, 4);  expect(m.getState().timeSig).toEqual({ num: 3, den: 4 });
    m.setTimeSig(0, 4);  expect(m.getState().timeSig).toEqual({ num: 3, den: 4 });   // rejected
    m.setTimeSig(4, 5);  expect(m.getState().timeSig).toEqual({ num: 3, den: 4 });   // den ∉ {2,4,8,16}
    m.setTuning('DropD');    expect(m.getState().tuning).toBe('DropD');
    m.setTuning('Ukulele');  expect(m.getState().tuning).toBe('DropD');              // unknown → no-op
    m.setCapo(99); expect(m.getState().capo).toBe(10);
    m.setCapo(-1); expect(m.getState().capo).toBe(0);
    m.setCapo(3);  expect(m.getState().capo).toBe(3);
  });

  it('tuning change keeps FRETS — pitch re-derives (tab is fret notation)', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 5, fret: 0 });   // low E open = 40
    m.setTuning('DropD');
    expect(m.getState().notes[0].fret).toBe(0);             // fret untouched
    expect(midiAt(m.getState(), m.getState().notes[0])).toBe(38);   // now sounds D
    expect(a).toBeTruthy();
  });

  it('notesWithTime derives midi + seconds, sorted by (tick, string)', () => {
    const m = createTabModel({ tempo: 120 });
    m.addNote({ tick: 12, string: 3, fret: 5, durTicks: 12 });
    m.addNote({ tick: 0, string: 4, fret: 2, durTicks: 6 });
    m.addNote({ tick: 12, string: 1, fret: 0 });
    const t = m.notesWithTime();
    expect(t.map((n) => [n.tick, n.string])).toEqual([[0, 4], [12, 1], [12, 3]]);
    expect(t[0]).toMatchObject({ midi: 47, tSec: 0, durSec: 0.25 });
    expect(t[2]).toMatchObject({ midi: 55, tSec: 0.5, durSec: 0.5 });
  });

  it('tempo change re-times everything for free (seconds are derived)', () => {
    const m = createTabModel({ tempo: 120 });
    m.addNote({ tick: 12, string: 3, fret: 5 });
    expect(m.notesWithTime()[0].tSec).toBeCloseTo(0.5, 10);
    m.setTempo(60);
    expect(m.notesWithTime()[0].tSec).toBeCloseTo(1, 10);
  });
});

describe('serialize / load / migrateV1', () => {
  it('serialize returns v2 state plus a bpm alias (legacy consumers read .bpm)', () => {
    const m = createTabModel({ tempo: 90 });
    m.addNote({ tick: 24, string: 2, fret: 0 });
    const s = m.serialize();
    expect(s).toMatchObject({ version: 2, tempo: 90, bpm: 90, tuning: 'EADGBE', capo: 0 });
    expect(s.timeSig).toEqual({ num: 4, den: 4 });
    expect(s.notes).toHaveLength(1);
  });

  it('migrateV1 maps col→tick, quantizes durations, preserves detection', () => {
    const v1 = {
      bpm: 120, tuning: 'EADGBE',
      notes: [{
        id: 1, col: 8, string: 2, fret: 0, midi: 55,
        detMidi: 55, detString: 3, detFret: 5, edited: true, tSec: 1.01, durSec: 0.4,
      }],
    };
    const s = migrateV1(v1);
    expect(s).toMatchObject({ version: 2, tempo: 120, tuning: 'EADGBE', capo: 0 });
    expect(s.timeSig).toEqual({ num: 4, den: 4 });
    expect(s.notes[0]).toEqual({
      id: 1, tick: 24, durTicks: 9, string: 2, fret: 0, tech: {},
      det: { midi: 55, string: 3, fret: 5, tSec: 1.01, durSec: 0.4 },
    });
  });

  it('load accepts v1 (migrates) or v2; hands out fresh state', () => {
    const m = createTabModel();
    m.load({ bpm: 90, tuning: 'EADGBE', notes: [{ col: 4, string: 3, fret: 5, midi: 55, detMidi: 55, detString: 3, detFret: 5, tSec: 0.5, durSec: 0.3 }] });
    expect(m.getState().tempo).toBe(90);
    expect(m.getState().notes[0]).toMatchObject({ tick: 12, string: 3, fret: 5 });

    const m2 = createTabModel();
    m2.load(m.serialize());
    expect(m2.getState().tempo).toBe(90);
    expect(m2.getState().notes).toHaveLength(1);
  });

  it('load(null) / load({}) resets to empty defaults', () => {
    const m = createTabModel({ tempo: 90 });
    m.addNote({ tick: 0, string: 0, fret: 0 });
    m.load(null);
    expect(m.getState()).toMatchObject({ version: 2, tempo: 120, notes: [] });
  });
});

describe('subscribe / undo / redo', () => {
  it('subscribe fires once per mutation with fresh state; unsubscribe stops it', () => {
    const m = createTabModel();
    const cb = vi.fn();
    const un = m.subscribe(cb);
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    m.setFret(a, 7);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0].notes[0].fret).toBe(7);
    un();
    m.setFret(a, 9);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('no-op mutations do not notify and do not create undo snapshots', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const cb = vi.fn();
    m.subscribe(cb);
    expect(m.setFret(a, 5)).toBe(true);        // same value
    m.setTempo(120);                            // same tempo
    m.setTuning('EADGBE');                      // same tuning
    expect(m.moveNote(a, {})).toBe(true);       // nowhere to go
    expect(cb).not.toHaveBeenCalled();
    expect(m.undo()).toBe(true);                // only the addNote snapshot exists
    expect(m.getState().notes).toEqual([]);
    expect(m.canUndo()).toBe(false);
  });

  it('undo walks back through every op kind; redo replays; a new edit clears redo', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    m.moveNote(a, { string: 2 });                        // D/5 → G/0
    m.setTempo(90);
    expect(m.getState()).toMatchObject({ tempo: 90 });
    expect(m.undo()).toBe(true);                         // undo tempo
    expect(m.getState().tempo).toBe(120);
    expect(m.undo()).toBe(true);                         // undo move
    expect(m.getState().notes[0]).toMatchObject({ string: 3, fret: 5 });
    expect(m.redo()).toBe(true);                         // redo move
    expect(m.getState().notes[0]).toMatchObject({ string: 2, fret: 0 });
    expect(m.canRedo()).toBe(true);
    m.setFret(m.getState().notes[0].id, 3);              // new edit → redo history gone
    expect(m.canRedo()).toBe(false);
    expect(m.redo()).toBe(false);
  });

  it('undo() on empty history is false; the stack caps at 100 snapshots', () => {
    const m = createTabModel();
    expect(m.undo()).toBe(false);
    for (let i = 0; i < 105; i++) m.addNote({ tick: i * 3, string: 0, fret: 1 });
    let undone = 0;
    while (m.undo()) undone++;
    expect(undone).toBe(100);
    expect(m.getState().notes).toHaveLength(5);          // the 5 oldest adds survive the cap
  });

  it('undo notifies subscribers; load resets both stacks', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 3, fret: 5 });
    const cb = vi.fn();
    m.subscribe(cb);
    m.undo();
    expect(cb).toHaveBeenCalledTimes(1);
    m.addNote({ tick: 0, string: 3, fret: 5 });
    m.load(m.serialize());
    expect(m.canUndo()).toBe(false);
    expect(m.canRedo()).toBe(false);
  });
});

describe('copyRange / pasteAt', () => {
  it('copies [start, end) as relative ticks without det or ids', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 3, fret: 5, det: { midi: 55, string: 3, fret: 5, tSec: 0, durSec: 0.3 } });
    m.addNote({ tick: 3, string: 2, fret: 0, durTicks: 6 });
    m.addNote({ tick: 12, string: 3, fret: 7 });                      // at end — excluded
    const p = m.copyRange(0, 12);
    expect(p.span).toBe(12);
    expect(p.notes).toEqual([
      { relTick: 0, string: 3, fret: 5, durTicks: 3, tech: {} },
      { relTick: 3, string: 2, fret: 0, durTicks: 6, tech: {} },
    ]);
  });

  it('pastes at a tick as ONE undoable step, replacing occupants, returning new ids', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 3, fret: 5 });
    m.addNote({ tick: 3, string: 2, fret: 0 });
    m.addNote({ tick: 24, string: 3, fret: 9 });                      // will be overwritten
    const p = m.copyRange(0, 6);
    const cb = vi.fn();
    m.subscribe(cb);
    const ids = m.pasteAt(24, p);
    expect(ids).toHaveLength(2);
    expect(cb).toHaveBeenCalledTimes(1);                              // one emit for the whole paste
    const notes = m.getState().notes;
    expect(notes.find((n) => n.tick === 24 && n.string === 3).fret).toBe(5);   // occupant replaced
    expect(notes.find((n) => n.tick === 27 && n.string === 2).fret).toBe(0);
    expect(m.undo()).toBe(true);                                      // whole paste reverts at once
    expect(m.getState().notes.find((n) => n.tick === 24 && n.string === 3).fret).toBe(9);
  });

  it('empty/invalid payloads paste nothing', () => {
    const m = createTabModel();
    expect(m.pasteAt(0, null)).toEqual([]);
    expect(m.pasteAt(0, { span: 0, notes: [] })).toEqual([]);
    expect(m.getState().notes).toEqual([]);
    expect(m.canUndo()).toBe(false);
  });
});
