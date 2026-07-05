import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTabModel } from '../src/tab/tab-model.js';

describe('tab-model toggleTech', () => {
  it('sets a technique on the given ids and reports the count', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 3, string: 3, fret: 7 });
    expect(m.toggleTech([a, b], 'pm', true)).toBe(2);
    expect(m.getState().notes.map((n) => n.tech)).toEqual([{ pm: true }, { pm: true }]);
  });

  it('same value toggles OFF; a different value replaces', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    m.toggleTech([a], 'hp', 'h');
    expect(m.getState().notes[0].tech).toEqual({ hp: 'h' });
    m.toggleTech([a], 'hp', 'p');                          // replace
    expect(m.getState().notes[0].tech).toEqual({ hp: 'p' });
    m.toggleTech([a], 'hp', 'p');                          // toggle off
    expect(m.getState().notes[0].tech).toEqual({});
  });

  it('per-note toggle: a mixed selection flips each note relative to itself', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const b = m.addNote({ tick: 3, string: 3, fret: 7 });
    m.toggleTech([a], 'dead', true);
    expect(m.toggleTech([a, b], 'dead', true)).toBe(2);
    const [na, nb] = m.getState().notes;
    expect(na.tech).toEqual({});                           // was on → off
    expect(nb.tech).toEqual({ dead: true });               // was off → on
  });

  it('techniques stack: hp and pm can coexist on one note', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    m.toggleTech([a], 'hp', 'h');
    m.toggleTech([a], 'pm', true);
    expect(m.getState().notes[0].tech).toEqual({ hp: 'h', pm: true });
  });

  it('bend accepts ½ and full tone', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    expect(m.toggleTech([a], 'bend', 0.5)).toBe(1);
    expect(m.getState().notes[0].tech).toEqual({ bend: 0.5 });
    expect(m.toggleTech([a], 'bend', 1)).toBe(1);
    expect(m.getState().notes[0].tech).toEqual({ bend: 1 });
  });

  it('rejects unknown keys and illegal values', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    expect(m.toggleTech([a], 'vibrato', true)).toBe(0);
    expect(m.toggleTech([a], 'bend', 2)).toBe(0);
    expect(m.toggleTech([a], 'hp', 'x')).toBe(0);
    expect(m.toggleTech([a], 'slide', '|')).toBe(0);
    expect(m.getState().notes[0].tech).toEqual({});
  });

  it('missing ids → 0, no undo snapshot', () => {
    const m = createTabModel();
    expect(m.toggleTech([99], 'pm', true)).toBe(0);
    expect(m.canUndo()).toBe(false);
  });

  it('is undoable and notifies subscribers', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    const cb = vi.fn();
    m.subscribe(cb);
    m.toggleTech([a], 'dead', true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(m.undo()).toBe(true);
    expect(m.getState().notes[0].tech).toEqual({});
  });

  it('tech rides copy/paste', () => {
    const m = createTabModel();
    const a = m.addNote({ tick: 0, string: 3, fret: 5 });
    m.toggleTech([a], 'slide', '/');
    const payload = m.copyRange(0, 3);
    const [id] = m.pasteAt(24, payload);
    expect(m.getState().notes.find((n) => n.id === id).tech).toEqual({ slide: '/' });
  });
});

import { attachTabInput } from '../src/tab/tab-input.js';
import { setCapability } from '../src/features.js';

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

afterEach(() => setCapability('tab.techniques', true));   // registry is module-global — always restore

describe('tab-input technique keys', () => {
  it('h/p/x/m toggle on the note under the cursor', () => {
    const { stage, model } = mountInput();
    model.addNote({ tick: 0, string: 0, fret: 5 });        // under the default cursor
    key(stage, 'h');
    expect(model.getState().notes[0].tech).toEqual({ hp: 'h' });
    key(stage, 'h');                                       // same key clears
    expect(model.getState().notes[0].tech).toEqual({});
    key(stage, 'p');
    key(stage, 'x');
    key(stage, 'm');
    expect(model.getState().notes[0].tech).toEqual({ hp: 'p', dead: true, pm: true });
  });

  it('slide keys mark direction; repeating clears', () => {
    const { stage, model } = mountInput();
    model.addNote({ tick: 0, string: 0, fret: 5 });
    key(stage, '/');
    expect(model.getState().notes[0].tech).toEqual({ slide: '/' });
    key(stage, '\\');
    expect(model.getState().notes[0].tech).toEqual({ slide: '\\' });
    key(stage, '\\');
    expect(model.getState().notes[0].tech).toEqual({});
  });

  it('b cycles the bend: ½ → full → off', () => {
    const { stage, model } = mountInput();
    model.addNote({ tick: 0, string: 0, fret: 5 });
    key(stage, 'b');
    expect(model.getState().notes[0].tech).toEqual({ bend: 0.5 });
    key(stage, 'b');
    expect(model.getState().notes[0].tech).toEqual({ bend: 1 });
    key(stage, 'b');
    expect(model.getState().notes[0].tech).toEqual({});
  });

  it('applies to every note in the selection', () => {
    const { stage, model, ui } = mountInput();
    const a = model.addNote({ tick: 0, string: 0, fret: 5 });
    const b = model.addNote({ tick: 3, string: 1, fret: 7 });
    const c = model.addNote({ tick: 12, string: 0, fret: 3 });   // outside the selection
    ui.selection = { startTick: 0, endTick: 6 };                 // [start, end) — copyRange semantics
    key(stage, 'm');
    const byId = new Map(model.getState().notes.map((n) => [n.id, n.tech]));
    expect(byId.get(a)).toEqual({ pm: true });
    expect(byId.get(b)).toEqual({ pm: true });
    expect(byId.get(c)).toEqual({});
  });

  it('empty cursor cell → no-op', () => {
    const { stage, model, ui } = mountInput();
    model.addNote({ tick: 12, string: 3, fret: 5 });
    ui.cursor = { tick: 0, string: 0 };                          // nothing here
    key(stage, 'h');
    expect(model.getState().notes[0].tech).toEqual({});
  });

  it("can('tab.techniques') off → keys are inert", () => {
    setCapability('tab.techniques', false);
    const { stage, model } = mountInput();
    model.addNote({ tick: 0, string: 0, fret: 5 });
    key(stage, 'x');
    key(stage, 'b');
    expect(model.getState().notes[0].tech).toEqual({});
  });
});

import { createTabRenderer, xForTick, yForString, COL_W } from '../src/tab/tab-render.js';

// Minimal v2 state around a notes array; ids are 1-based positions.
const stateWith = (notes) => ({
  version: 2, tempo: 120, timeSig: { num: 4, den: 4 }, tuning: 'EADGBE', capo: 0,
  notes: notes.map((n, i) => ({ id: i + 1, string: 0, fret: 0, durTicks: 3, tech: {}, det: null, ...n })),
});
const UI = { cursor: null, selection: null, currentDur: 3 };

function draw(notes) {
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  document.body.appendChild(stage);
  const r = createTabRenderer(stage);
  r.render(stateWith(notes), UI);
  return { stage, r };
}

describe('tab-render technique glyphs', () => {
  it('hp arc spans from the previous note on the string, letter via data-t', () => {
    const { stage } = draw([
      { tick: 0, string: 3, fret: 5 },
      { tick: 6, string: 3, fret: 7, tech: { hp: 'h' } },
    ]);
    const arc = stage.querySelector('.tab-glyph.hp');
    expect(arc.dataset.t).toBe('h');
    expect(arc.style.left).toBe(`${xForTick(0) + 5}px`);
    expect(arc.style.width).toBe(`${xForTick(6) - 5 - (xForTick(0) + 5)}px`);
    expect(arc.style.top).toBe(`${yForString(3) - 11}px`);
  });

  it('phrase-opening hp gets a stub arc; string 0 clamps to the stage headroom', () => {
    const { stage } = draw([{ tick: 6, string: 0, fret: 7, tech: { hp: 'p' } }]);
    const arc = stage.querySelector('.tab-glyph.hp');
    expect(arc.dataset.t).toBe('p');
    expect(arc.style.left).toBe(`${xForTick(6) - COL_W / 2}px`);
    expect(arc.style.top).toBe('-4px');
  });

  it('slides slant up or down right after the note, on the string line', () => {
    const { stage } = draw([
      { tick: 12, string: 0, fret: 9, tech: { slide: '/' } },
      { tick: 24, string: 2, fret: 5, tech: { slide: '\\' } },
    ]);
    const up = stage.querySelector('.tab-glyph.slide.up');
    const down = stage.querySelector('.tab-glyph.slide.down');
    expect(up.style.left).toBe(`${xForTick(12) + 7}px`);
    expect(up.style.top).toBe(`${yForString(0) - 3}px`);
    expect(down.style.top).toBe(`${yForString(2) - 3}px`);
  });

  it('bend shows the amount above the note', () => {
    const { stage } = draw([
      { tick: 0, string: 1, fret: 7, tech: { bend: 0.5 } },
      { tick: 12, string: 4, fret: 9, tech: { bend: 1 } },
    ]);
    const [half, full] = stage.querySelectorAll('.tab-glyph.bend');
    expect(half.textContent).toBe('½');
    expect(half.style.top).toBe(`${yForString(1) - 13}px`);
    expect(full.textContent).toBe('full');
  });

  it('dead notes display × on the note span; toggling back restores the fret', () => {
    const { stage, r } = draw([{ tick: 0, string: 5, fret: 0, tech: { dead: true } }]);
    const note = stage.querySelector('.tab-note');
    expect(note.textContent).toBe('×');
    expect(note.classList.contains('dead')).toBe(true);
    r.render(stateWith([{ tick: 0, string: 5, fret: 0, tech: {} }]), UI);
    expect(stage.querySelector('.tab-note').textContent).toBe('0');
    expect(stage.querySelector('.tab-note').classList.contains('dead')).toBe(false);
  });

  it('PM chains muted columns within a beat into one span; a gap starts a new one', () => {
    const { stage } = draw([
      { tick: 0, string: 5, fret: 0, tech: { pm: true } },
      { tick: 6, string: 5, fret: 0, tech: { pm: true } },
      { tick: 12, string: 5, fret: 0, tech: { pm: true } },
      { tick: 36, string: 5, fret: 0, tech: { pm: true } },
    ]);
    const spans = stage.querySelectorAll('.tab-glyph.pm');
    expect(spans).toHaveLength(2);
    expect(spans[0].textContent).toBe('PM');
    expect(spans[0].style.left).toBe(`${xForTick(0) - 6}px`);
    expect(spans[0].style.width).toBe(`${xForTick(12) - xForTick(0) + 12}px`);
    expect(spans[1].style.left).toBe(`${xForTick(36) - 6}px`);
    expect(spans[1].style.width).toBe('18px');
  });

  it('a chord under one PM column renders a single span (ticks dedupe)', () => {
    const { stage } = draw([
      { tick: 0, string: 4, fret: 2, tech: { pm: true } },
      { tick: 0, string: 5, fret: 0, tech: { pm: true } },
    ]);
    expect(stage.querySelectorAll('.tab-glyph.pm')).toHaveLength(1);
  });
});
