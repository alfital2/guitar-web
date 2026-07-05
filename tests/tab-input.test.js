import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTabModel } from '../src/tab/tab-model.js';
import { createTabRenderer, COL_W, LINE_GAP, xForTick } from '../src/tab/tab-render.js';
import { attachTabInput } from '../src/tab/tab-input.js';
import { setCapability } from '../src/features.js';

afterEach(() => setCapability('tab.edit', true));   // registry is module-global — always restore

// Real renderer in the loop so pointer tests hit actual .tab-note spans.
function mount() {
  const scrollEl = document.createElement('div');
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  scrollEl.appendChild(stage);
  document.body.appendChild(scrollEl);
  const model = createTabModel();
  const ui = { cursor: null, selection: null, currentDur: 3 };
  const renderer = createTabRenderer(stage);
  const requestRender = vi.fn(() => renderer.render(model.getState(), ui));
  model.subscribe((s) => renderer.render(s, ui));
  const onEditFret = vi.fn();
  const api = attachTabInput({ scrollEl, stage, model, ui, requestRender, onEditFret });
  return { stage, model, ui, renderer, requestRender, onEditFret, api };
}

const key = (stage, k, opts = {}) =>
  stage.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));

// jsdom has no PointerEvent — the handlers listen by event NAME, so a
// MouseEvent with the right type works (pointerId lands undefined; capture
// calls are try/caught).
const pt = (stage, type, x, y) =>
  stage.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
const ptOn = (el, type, x, y) =>
  el.dispatchEvent(new MouseEvent(type, { button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));

describe('keyboard: fret entry', () => {
  it('a digit at the cursor creates the note with the current duration', () => {
    const { stage, model, ui } = mount();
    ui.cursor = { tick: 6, string: 3 };
    ui.currentDur = 12;
    key(stage, '5');
    expect(model.getState().notes[0]).toMatchObject({ tick: 6, string: 3, fret: 5, durTicks: 12 });
  });

  it('two digits within the window combine to 10–24', () => {
    const { stage, model, ui } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '1');
    key(stage, '2');
    expect(model.getState().notes).toHaveLength(1);
    expect(model.getState().notes[0].fret).toBe(12);
  });

  it('a combination past 24 starts fresh with the second digit', () => {
    const { stage, model, ui } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '2');
    key(stage, '5');                                   // 25 > 24 → replace with fret 5
    expect(model.getState().notes).toHaveLength(1);
    expect(model.getState().notes[0].fret).toBe(5);
  });

  it('flushing the pending digit ends the combination window', () => {
    const { stage, model, ui, api } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '1');
    api.__flushPendingDigit();
    key(stage, '2');                                   // fresh → replaces with fret 2
    expect(model.getState().notes).toHaveLength(1);
    expect(model.getState().notes[0].fret).toBe(2);
  });

  it('no cursor → digits are inert', () => {
    const { stage, model } = mount();
    key(stage, '5');
    expect(model.getState().notes).toEqual([]);
  });

  it("can('tab.edit') off → typing and deleting are inert, navigation still works", () => {
    setCapability('tab.edit', false);
    const { stage, model, ui } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '5');
    expect(model.getState().notes).toEqual([]);
    key(stage, 'ArrowRight');
    expect(ui.cursor.tick).toBe(3);
  });
});

describe('keyboard: navigation + selection', () => {
  it('arrows move the cursor on the grid, clamped at the edges', () => {
    const { stage, ui } = mount();
    key(stage, 'ArrowRight');                          // null cursor → starts at origin
    expect(ui.cursor).toEqual({ tick: 0, string: 0 });
    key(stage, 'ArrowRight');
    key(stage, 'ArrowDown');
    expect(ui.cursor).toEqual({ tick: 3, string: 1 });
    key(stage, 'ArrowLeft');
    key(stage, 'ArrowLeft');                           // clamps at 0
    key(stage, 'ArrowUp');
    key(stage, 'ArrowUp');                             // clamps at 0
    expect(ui.cursor).toEqual({ tick: 0, string: 0 });
  });

  it('Shift+arrows grow a [start, end) selection from the anchor', () => {
    const { stage, ui } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, 'ArrowRight', { shiftKey: true });
    expect(ui.selection).toEqual({ startTick: 0, endTick: 6 });
    key(stage, 'ArrowRight', { shiftKey: true });
    expect(ui.selection).toEqual({ startTick: 0, endTick: 9 });
    key(stage, 'ArrowLeft');                           // plain arrow drops it
    expect(ui.selection).toBe(null);
  });

  it('Escape clears the selection', () => {
    const { stage, ui, requestRender } = mount();
    ui.selection = { startTick: 0, endTick: 6 };
    key(stage, 'Escape');
    expect(ui.selection).toBe(null);
    expect(requestRender).toHaveBeenCalled();
  });

  it('Delete removes the selection contents; at the cursor it removes one note', () => {
    const { stage, model, ui } = mount();
    const a = model.addNote({ tick: 0, string: 0, fret: 1 });
    const b = model.addNote({ tick: 3, string: 1, fret: 2 });
    const c = model.addNote({ tick: 12, string: 0, fret: 3 });
    ui.selection = { startTick: 0, endTick: 6 };
    key(stage, 'Delete');
    expect(model.getState().notes.map((n) => n.id)).toEqual([c]);
    expect(ui.selection).toBe(null);
    ui.cursor = { tick: 12, string: 0 };
    key(stage, 'Backspace');
    expect(model.getState().notes).toEqual([]);
    expect(a).toBeTruthy(); expect(b).toBeTruthy();
  });
});

describe('keyboard: undo/redo + copy/paste', () => {
  it('Ctrl+Z undoes, Ctrl+Shift+Z redoes', () => {
    const { stage, model, ui } = mount();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '7');
    key(stage, 'z', { ctrlKey: true });
    expect(model.getState().notes).toEqual([]);
    key(stage, 'z', { ctrlKey: true, shiftKey: true });
    expect(model.getState().notes[0].fret).toBe(7);
  });

  it('Ctrl+C copies the selection, Ctrl+V pastes at the cursor', () => {
    const { stage, model, ui } = mount();
    model.addNote({ tick: 0, string: 3, fret: 5 });
    model.addNote({ tick: 3, string: 2, fret: 0 });
    ui.selection = { startTick: 0, endTick: 6 };
    key(stage, 'c', { ctrlKey: true });
    ui.cursor = { tick: 24, string: 0 };
    key(stage, 'v', { metaKey: true });                // Cmd works too
    const notes = model.getState().notes;
    expect(notes.find((n) => n.tick === 24 && n.string === 3).fret).toBe(5);
    expect(notes.find((n) => n.tick === 27 && n.string === 2).fret).toBe(0);
  });
});

describe('pointer', () => {
  it('click on an empty cell places the cursor there and clears the selection', () => {
    const { stage, ui } = mount();
    ui.selection = { startTick: 0, endTick: 6 };
    pt(stage, 'pointerdown', xForTick(6), LINE_GAP * 2);
    pt(stage, 'pointerup', xForTick(6), LINE_GAP * 2);
    expect(ui.cursor).toEqual({ tick: 6, string: 2 });
    expect(ui.selection).toBe(null);
  });

  it('click on a note selects it (cursor follows the note cell)', () => {
    const { stage, model, ui } = mount();
    model.addNote({ tick: 12, string: 3, fret: 5 });
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'pointerdown', xForTick(12), LINE_GAP * 3);
    pt(stage, 'pointerup', xForTick(12), LINE_GAP * 3);
    expect(ui.cursor).toEqual({ tick: 12, string: 3 });
  });

  it('vertical drag moves a note to another string, pitch preserved', () => {
    const { stage, model } = mount();
    model.addNote({ tick: 0, string: 3, fret: 5 });    // D/5 = 55
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'pointerdown', xForTick(0), LINE_GAP * 3);
    pt(stage, 'pointermove', xForTick(0), LINE_GAP * 2);   // up to the G line
    pt(stage, 'pointerup', xForTick(0), LINE_GAP * 2);
    expect(model.getState().notes[0]).toMatchObject({ string: 2, fret: 0 });
  });

  it('impossible string drag rejects with a shake, note unchanged', () => {
    const { stage, model } = mount();
    model.addNote({ tick: 0, string: 5, fret: 0 });    // low E open = 40
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'pointerdown', xForTick(0), LINE_GAP * 5);
    pt(stage, 'pointermove', xForTick(0), 0);          // to the high e line
    pt(stage, 'pointerup', xForTick(0), 0);
    expect(model.getState().notes[0]).toMatchObject({ string: 5, fret: 0 });
    expect(stage.querySelector('.tab-note').classList.contains('invalid')).toBe(true);
  });

  it('horizontal drag moves a note in time, snapped to the grid', () => {
    const { stage, model } = mount();
    model.addNote({ tick: 0, string: 3, fret: 5 });
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'pointerdown', xForTick(0), LINE_GAP * 3);
    pt(stage, 'pointermove', xForTick(6) + 4, LINE_GAP * 3);   // near col 2
    pt(stage, 'pointerup', xForTick(6) + 4, LINE_GAP * 3);
    expect(model.getState().notes[0]).toMatchObject({ tick: 6, string: 3, fret: 5 });
  });

  it('horizontal drag on empty space sweeps a column selection', () => {
    const { stage, ui } = mount();
    pt(stage, 'pointerdown', xForTick(3), LINE_GAP);
    pt(stage, 'pointermove', xForTick(12), LINE_GAP);
    pt(stage, 'pointerup', xForTick(12), LINE_GAP);
    expect(ui.selection).toEqual({ startTick: 3, endTick: 15 });
  });

  it('double-click on a note asks the lane for an inline fret edit', () => {
    const { stage, model, onEditFret } = mount();
    const id = model.addNote({ tick: 0, string: 1, fret: 9 });
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'dblclick', xForTick(0), LINE_GAP);
    expect(onEditFret).toHaveBeenCalledWith(id);
  });

  it("can('tab.edit') off → drags do not move notes", () => {
    setCapability('tab.edit', false);
    const { stage, model } = mount();
    model.addNote({ tick: 0, string: 3, fret: 5 });
    const el = stage.querySelector('.tab-note');
    ptOn(el, 'pointerdown', xForTick(0), LINE_GAP * 3);
    pt(stage, 'pointermove', xForTick(0), LINE_GAP * 2);
    pt(stage, 'pointerup', xForTick(0), LINE_GAP * 2);
    expect(model.getState().notes[0]).toMatchObject({ string: 3, fret: 5 });
  });
});

describe('destroy', () => {
  it('detaches every listener', () => {
    const { stage, model, ui, api } = mount();
    api.destroy();
    ui.cursor = { tick: 0, string: 0 };
    key(stage, '5');
    expect(model.getState().notes).toEqual([]);
  });
});
