import { describe, it, expect, beforeEach } from 'vitest';
import { createTabModel, TUNING_PRESETS } from '../src/tab/tab-model.js';
import { mountTabLane } from '../src/tab/tab-lane.js';

describe('tab-model tuning + capo', () => {
  it('setTuning keeps frets and re-derives pitch (tab is fret notation)', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 5, fret: 0 });          // open low E
    expect(m.notesWithTime()[0].midi).toBe(40);
    m.setTuning('DropD');
    expect(m.getState().tuning).toBe('DropD');
    expect(m.getState().notes[0].fret).toBe(0);          // fret KEPT
    expect(m.notesWithTime()[0].midi).toBe(38);          // pitch re-derived
  });

  it('rejects unknown presets', () => {
    const m = createTabModel();
    m.setTuning('nope');
    expect(m.getState().tuning).toBe('EADGBE');
  });

  it('setCapo shifts derived pitch and clamps 0–10', () => {
    const m = createTabModel();
    m.addNote({ tick: 0, string: 5, fret: 0 });
    m.setCapo(3);
    expect(m.getState().capo).toBe(3);
    expect(m.notesWithTime()[0].midi).toBe(43);
    m.setCapo(99); expect(m.getState().capo).toBe(10);
    m.setCapo(-2); expect(m.getState().capo).toBe(0);
  });

  it('tuning and capo changes are undoable', () => {
    const m = createTabModel();
    m.setTuning('DADGAD');
    m.setCapo(2);
    expect(m.undo()).toBe(true);
    expect(m.getState().capo).toBe(0);
    expect(m.undo()).toBe(true);
    expect(m.getState().tuning).toBe('EADGBE');
  });

  it('moveNote preserves pitch under the CURRENT tuning', () => {
    const m = createTabModel();
    m.setTuning('DropD');
    const id = m.addNote({ tick: 0, string: 4, fret: 0 });   // open A = midi 45
    expect(m.moveNote(id, { string: 5 })).toBe(true);
    const [n] = m.getState().notes;
    expect(n.string).toBe(5);
    expect(n.fret).toBe(7);                                  // dropped D (38) + 7 = 45
  });
});

let container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

describe('tab-lane header: tuning + capo pickers, tuning-driven gutter', () => {
  it('tuning picker commits through the model and renames the gutter strings', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const sel = container.querySelector('.tab-tuning');
    expect(sel.value).toBe('EADGBE');
    sel.value = 'DADGAD';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.serialize().tuning).toBe('DADGAD');
    const names = [...container.querySelectorAll('.tab-gutter i')].map((i) => i.textContent);
    expect(names).toEqual(TUNING_PRESETS.DADGAD.names);      // ['d','A','G','D','A','D']
  });

  it('typed capo commits through the model, clamped to fret 10; blank clears', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const input = container.querySelector('input.tab-capo');
    input.value = '2';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.serialize().capo).toBe(2);
    input.value = '15';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.serialize().capo).toBe(10);
    expect(input.value).toBe('10');                          // readout reflects the clamp
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.serialize().capo).toBe(0);
  });

  it('loading a v2 state reflects its tuning in picker and gutter', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.loadNotes({ version: 2, tempo: 100, timeSig: { num: 4, den: 4 }, tuning: 'DropD', capo: 1, notes: [] });
    expect(container.querySelector('.tab-tuning').value).toBe('DropD');
    expect(container.querySelector('input.tab-capo').value).toBe('1');
    const names = [...container.querySelectorAll('.tab-gutter i')].map((i) => i.textContent);
    expect(names).toEqual(TUNING_PRESETS.DropD.names);       // ['e','B','G','D','A','D']
  });
});
