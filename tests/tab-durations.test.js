import { describe, it, expect, vi } from 'vitest';
import { createTabModel, DURATIONS, PPQ } from '../src/tab/tab-model.js';

describe('tab-model setDuration', () => {
  it('sets a legal duration on the given ids and reports the count', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 3, string: 2, fret: 0 });
    expect(m.setDuration([a, b], 24)).toBe(2);
    expect(m.getState().notes.map((n) => n.durTicks)).toEqual([24, 24]);
  });

  it('skips notes already at the target value in the count', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });          // durTicks defaults 3
    const b = m.addNote({ tick: 3, string: 2, fret: 0, durTicks: 12 });
    expect(m.setDuration([a, b], 12)).toBe(1);
  });

  it('rejects values outside DURATIONS', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    expect(m.setDuration([a], 5)).toBe(0);                          // not a legal value
    expect(m.setDuration([a], 4.5)).toBe(0);                        // dotted 16th doesn't exist
    expect(m.getState().notes[0].durTicks).toBe(3);
  });

  it('is undoable and notifies subscribers', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const cb = vi.fn();
    m.subscribe(cb);
    m.setDuration([a], 48);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(m.undo()).toBe(true);
    expect(m.getState().notes[0].durTicks).toBe(3);
  });
});

import { createTabRenderer, xForTick } from '../src/tab/tab-render.js';

// Minimal v2 state around a notes array; ids are 1-based positions.
const stateWith = (notes, timeSig = { num: 4, den: 4 }) => ({
  version: 2, tempo: 120, timeSig, tuning: 'EADGBE', capo: 0,
  notes: notes.map((n, i) => ({ id: i + 1, string: 0, fret: 0, tech: {}, det: null, ...n })),
});
const UI = { cursor: null, selection: null, currentDur: 3 };

function draw(notes) {
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  document.body.appendChild(stage);
  const r = createTabRenderer(stage);
  r.render(stateWith(notes), UI);
  return stage;
}

describe('tab-render rhythm layer (stems/beams/dots)', () => {
  it('whole notes carry no stem; halves get a short stem; quarters a full stem', () => {
    expect(draw([{ tick: 0, durTicks: 48 }]).querySelectorAll('.tab-stem').length).toBe(0);
    const half = draw([{ tick: 0, durTicks: 24 }]).querySelector('.tab-stem');
    expect(half.classList.contains('short')).toBe(true);
    const quarter = draw([{ tick: 0, durTicks: 12 }]).querySelector('.tab-stem');
    expect(quarter.classList.contains('short')).toBe(false);
    expect(quarter.style.left).toBe(`${xForTick(0)}px`);
  });

  it('dotted values render a dot beside the stem', () => {
    const stage = draw([{ tick: 0, durTicks: 18 }]);               // dotted quarter
    expect(stage.querySelectorAll('.tab-dot').length).toBe(1);
    expect(stage.querySelector('.tab-dot').style.left).toBe(`${xForTick(0) + 4}px`);
    expect(draw([{ tick: 0, durTicks: 12 }]).querySelectorAll('.tab-dot').length).toBe(0);
  });

  it('beams two contiguous 8ths inside a beat; no leftover flags', () => {
    const stage = draw([{ tick: 0, durTicks: 6 }, { tick: 6, durTicks: 6, string: 1 }]);
    const beams = stage.querySelectorAll('.tab-beam:not(.flag)');
    expect(beams.length).toBe(1);
    expect(beams[0].style.left).toBe(`${xForTick(0)}px`);
    expect(beams[0].style.width).toBe(`${xForTick(6) - xForTick(0)}px`);
    expect(stage.querySelectorAll('.tab-beam.flag').length).toBe(0);
  });

  it('does not beam across a quarter-beat boundary — isolated 8ths get flags', () => {
    const stage = draw([{ tick: 6, durTicks: 6 }, { tick: 12, durTicks: 6, string: 1 }]);
    expect(stage.querySelectorAll('.tab-beam:not(.flag)').length).toBe(0);
    expect(stage.querySelectorAll('.tab-beam.flag').length).toBe(2);
  });

  it('16ths beam at two levels; a mixed 8th+16th pair shares level 0 and flags level 1', () => {
    const sixteenths = draw([{ tick: 0, durTicks: 3 }, { tick: 3, durTicks: 3, string: 1 }]);
    expect(sixteenths.querySelectorAll('.tab-beam:not(.flag)').length).toBe(2);
    const mixed = draw([{ tick: 0, durTicks: 6 }, { tick: 6, durTicks: 3, string: 1 }]);
    expect(mixed.querySelectorAll('.tab-beam:not(.flag)').length).toBe(1);
    expect(mixed.querySelectorAll('.tab-beam.flag').length).toBe(1);
  });

  it('a chord shares one stem; the shortest duration in the column wins', () => {
    const stage = draw([{ tick: 0, durTicks: 12 }, { tick: 0, durTicks: 6, string: 3 }]);
    expect(stage.querySelectorAll('.tab-stem').length).toBe(1);
    expect(stage.querySelectorAll('.tab-beam.flag').length).toBe(1);   // 8th flag
  });
});

import { attachTabInput } from '../src/tab/tab-input.js';

function mountInput() {
  const scrollEl = document.createElement('div');
  const stage = document.createElement('div');
  scrollEl.appendChild(stage);
  document.body.appendChild(scrollEl);
  const model = createTabModel();
  const ui = { cursor: { tick: 0, string: 0 }, selection: null, currentDur: 3 };
  const requestRender = vi.fn();
  const api = attachTabInput({ scrollEl, stage, model, ui, requestRender, onEditFret: vi.fn() });
  stage.focus();
  return { stage, model, ui, requestRender, api };
}
const key = (stage, k) =>
  stage.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('tab-input duration keys', () => {
  it('QWERT set the current duration when nothing is selected', () => {
    const { stage, ui, requestRender } = mountInput();
    for (const [k, dur] of [['q', 48], ['w', 24], ['e', 12], ['r', 6], ['t', 3]]) {
      key(stage, k);
      expect(ui.currentDur).toBe(dur);
    }
    expect(requestRender).toHaveBeenCalled();     // ui-only change still re-renders
  });

  it('dot toggles dotted on the current duration; whole and 16th no-op', () => {
    const { stage, ui } = mountInput();
    key(stage, 'w'); key(stage, '.');
    expect(ui.currentDur).toBe(36);               // dotted half
    key(stage, '.');
    expect(ui.currentDur).toBe(24);               // toggled back
    key(stage, 't'); key(stage, '.');
    expect(ui.currentDur).toBe(3);                // no dotted 16th at PPQ 12
    key(stage, 'q'); key(stage, '.');
    expect(ui.currentDur).toBe(48);               // no dotted whole in DURATIONS
  });

  it('applies to the selection when one exists', () => {
    const { stage, model, ui } = mountInput();
    const a = model.addNote({ tick: 0, string: 0, fret: 5 });
    const b = model.addNote({ tick: 3, string: 1, fret: 7 });
    const c = model.addNote({ tick: 12, string: 0, fret: 3 });    // outside the selection
    ui.selection = { startTick: 0, endTick: 12 };                 // [start, end) — copyRange semantics
    key(stage, 'w');
    const byId = new Map(model.getState().notes.map((n) => [n.id, n.durTicks]));
    expect(byId.get(a)).toBe(24);
    expect(byId.get(b)).toBe(24);
    expect(byId.get(c)).toBe(3);
  });

  it('dot on a selection toggles each note relative to itself', () => {
    const { stage, model, ui } = mountInput();
    const a = model.addNote({ tick: 0, string: 0, fret: 5, durTicks: 12 });
    const b = model.addNote({ tick: 3, string: 1, fret: 7, durTicks: 18 });
    ui.selection = { startTick: 0, endTick: 6 };
    key(stage, '.');
    const byId = new Map(model.getState().notes.map((n) => [n.id, n.durTicks]));
    expect(byId.get(a)).toBe(18);                 // quarter → dotted quarter
    expect(byId.get(b)).toBe(12);                 // dotted quarter → quarter
  });

  it('new notes take the current duration', () => {
    const { stage, model, ui, api } = mountInput();
    key(stage, 'e');                              // quarter
    key(stage, '5');
    api.__flushPendingDigit();
    const [n] = model.getState().notes;
    expect(n).toMatchObject({ tick: 0, string: 0, fret: 5, durTicks: 12 });
    expect(ui.currentDur).toBe(12);
  });
});
