// tests/tab-lane-v2.test.js — the lane's NEW editor surface (the v1 surface
// is pinned by tab-lane.test.js, kept byte-identical as the back-compat gate).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountTabLane } from '../src/tab/tab-lane.js';

let container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

const key = (stage, k, opts = {}) =>
  stage.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

describe('lane v2 shell', () => {
  it('header carries the extension spans later phases fill', () => {
    mountTabLane(container, { bpm: 120 });
    expect(container.querySelector('.tab-practice')).toBeTruthy();
    expect(container.querySelector('.tab-file-actions')).toBeTruthy();
  });

  it('meta line reads tempo · TS · tuning and follows model changes', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const meta = container.querySelector('.tab-meta');
    expect(meta.textContent).toBe('120 BPM · 4/4 · Standard');
    lane.getModel().setTimeSig(3, 4);
    lane.getModel().setTuning('DropD');
    lane.getModel().setCapo(2);
    expect(meta.textContent).toBe('120 BPM · 3/4 · Drop D · capo 2');
  });

  it('gutter string names follow the tuning', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const names = () => [...container.querySelectorAll('.tab-gutter i')].map((i) => i.textContent);
    expect(names()).toEqual(['e', 'B', 'G', 'D', 'A', 'E']);
    lane.getModel().setTuning('DADGAD');
    expect(names()).toEqual(['d', 'A', 'G', 'D', 'A', 'D']);
  });

  it('setBpm feeds the model — serialize carries tempo + bpm alias', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.setBpm(90);
    expect(lane.serialize()).toMatchObject({ version: 2, tempo: 90, bpm: 90 });
  });
});

describe('lane v2 editing pipeline', () => {
  it('typing at a clicked cell creates a note and fires onChange (user edit)', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const changes = vi.fn();
    lane.onChange(changes);
    lane.getUi().cursor = { tick: 6, string: 3 };
    key(container.querySelector('.tab-stage'), '5');
    expect(lane.noteCount()).toBe(1);
    expect(lane.getNotes()[0]).toMatchObject({ col: 2, string: 3, fret: 5, midi: 55 });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0][0]).toMatchObject({ version: 2 });
  });

  it('hand-entered notes have no detection: det mirrors current, edited stays false', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.getUi().cursor = { tick: 0, string: 2 };
    key(container.querySelector('.tab-stage'), '3');
    const [n] = lane.getNotes();
    expect(n).toMatchObject({ fret: 3, detFret: 3, detString: 2, edited: false });
    expect(n.tSec).toBe(0);                                  // grid-derived, no audio anchor
  });

  it('undo/redo ride the lane: Ctrl+Z removes the typed note', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const stage = container.querySelector('.tab-stage');
    lane.getUi().cursor = { tick: 0, string: 0 };
    key(stage, '7');
    expect(lane.noteCount()).toBe(1);
    key(stage, 'z', { ctrlKey: true });
    expect(lane.noteCount()).toBe(0);
    key(stage, 'z', { ctrlKey: true, shiftKey: true });
    expect(lane.noteCount()).toBe(1);
  });

  it('clear keeps tempo/TS/tuning, drops notes + cursor, fires no onChange', () => {
    const lane = mountTabLane(container, { bpm: 90 });
    const changes = vi.fn();
    lane.onChange(changes);
    lane.getModel().setTimeSig(3, 4);                        // a real edit → 1 change
    lane.noteOn(3, 5, 4, { midi: 55, tSec: 0.5, durSec: 0.3 });
    lane.getUi().cursor = { tick: 0, string: 0 };
    lane.clear();
    expect(lane.noteCount()).toBe(0);
    expect(lane.getUi().cursor).toBe(null);
    expect(lane.serialize()).toMatchObject({ tempo: 90 });
    expect(lane.serialize().timeSig).toEqual({ num: 3, den: 4 });
    expect(changes).toHaveBeenCalledTimes(1);                // only the TS edit
  });

  it('loadNotes(v1 model) migrates cols to ticks and keeps detection provenance', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.loadNotes({
      bpm: 90, tuning: 'EADGBE',
      notes: [{ id: 1, col: 8, string: 2, fret: 0, midi: 55, detMidi: 55, detString: 3, detFret: 5, edited: true, tSec: 1.0, durSec: 0.3 }],
    });
    expect(lane.serialize()).toMatchObject({ version: 2, tempo: 90 });
    const [n] = lane.getNotes();
    expect(n).toMatchObject({ col: 8, string: 2, fret: 0, detString: 3, detFret: 5, edited: true, tSec: 1.0 });
  });

  it('serialize → loadNotes v2 round-trip is lossless', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.getModel().setTuning('OpenG');
    lane.getModel().addNote({ tick: 6, string: 1, fret: 4, durTicks: 12, tech: { pm: true } });
    const dump = lane.serialize();
    const lane2 = mountTabLane(document.createElement('div'), { bpm: 120 });
    lane2.loadNotes(dump);
    expect(lane2.serialize()).toEqual(dump);
  });

  it('double-click inline editor commits through the model (undoable)', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const id = lane.noteOn(3, 5, 0, { midi: 55, tSec: 0, durSec: 0.3 });
    const el = container.querySelector(`.tab-note[data-id="${id}"]`);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    const input = el.querySelector('input.tab-note-input');
    expect(input).toBeTruthy();
    input.value = '9';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(lane.getNotes()[0]).toMatchObject({ fret: 9, edited: true });
    expect(el.textContent).toBe('9');
    expect(lane.getModel().undo()).toBe(true);
    expect(lane.getNotes()[0].fret).toBe(5);
  });

  it('destroy detaches editor input along with the DOM', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.getUi().cursor = { tick: 0, string: 0 };
    const stage = container.querySelector('.tab-stage');
    lane.destroy();
    key(stage, '5');
    expect(container.hidden).toBe(true);
    expect(container.innerHTML).toBe('');
  });
});
