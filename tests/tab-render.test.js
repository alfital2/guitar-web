import { describe, it, expect, beforeEach } from 'vitest';
import {
  COL_W, LINE_GAP, ROW_H, xForTick, tickForX, yForString, stringForY, createTabRenderer,
} from '../src/tab/tab-render.js';

const stateWith = (notes, timeSig = { num: 4, den: 4 }) => ({
  version: 2, tempo: 120, timeSig, tuning: 'EADGBE', capo: 0,
  notes: notes.map((n, i) => ({ id: i + 1, durTicks: 3, tech: {}, det: null, ...n })),
});
const UI = { cursor: null, selection: null, currentDur: 3 };

let stage;
beforeEach(() => {
  stage = document.createElement('div');
  stage.className = 'tab-stage';
  document.body.appendChild(stage);
});

describe('geometry', () => {
  it('tick ↔ x round-trips on the 16th grid', () => {
    expect(xForTick(0)).toBe(13);                 // column center
    expect(xForTick(3)).toBe(39);
    expect(tickForX(13)).toBe(0);
    expect(tickForX(39)).toBe(3);
    expect(tickForX(30)).toBe(3);                 // snaps to nearest column
    expect(tickForX(-50)).toBe(0);                // clamped
  });

  it('string ↔ y uses the line gap, clamped to 6 strings', () => {
    expect(yForString(0)).toBe(0);
    expect(yForString(5)).toBe(5 * LINE_GAP);
    expect(stringForY(-10)).toBe(0);
    expect(stringForY(31)).toBe(2);
    expect(stringForY(999)).toBe(5);
  });
});

describe('note rendering', () => {
  it('draws keyed spans with fret label at grid position', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([{ tick: 12, string: 3, fret: 5 }]), UI);
    const el = stage.querySelector('.tab-note[data-id="1"]');
    expect(el.textContent).toBe('5');
    expect(el.style.left).toBe(`${xForTick(12)}px`);
    expect(el.style.top).toBe(`${yForString(3)}px`);
  });

  it('marks edited when current differs from detection', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([
      { tick: 0, string: 2, fret: 0, det: { midi: 55, string: 3, fret: 5, tSec: 0, durSec: 0.3 } },
      { tick: 3, string: 3, fret: 5, det: { midi: 55, string: 3, fret: 5, tSec: 0.1, durSec: 0.3 } },
    ]), UI);
    expect(stage.querySelector('[data-id="1"]').classList.contains('edited')).toBe(true);
    expect(stage.querySelector('[data-id="2"]').classList.contains('edited')).toBe(false);
  });

  it('is incremental: same element reused across renders, stale notes removed, foreign classes survive', () => {
    const r = createTabRenderer(stage);
    const s1 = stateWith([{ tick: 0, string: 3, fret: 5 }, { tick: 3, string: 2, fret: 0 }]);
    r.render(s1, UI);
    const el = stage.querySelector('[data-id="1"]');
    el.classList.add('playing');                              // lane-owned class
    const s2 = stateWith([{ tick: 6, string: 3, fret: 7 }]);  // note 1 moved+refret, note 2 gone
    s2.notes[0].id = 1;
    r.render(s2, UI);
    expect(stage.querySelector('[data-id="1"]')).toBe(el);    // same element object
    expect(el.textContent).toBe('7');
    expect(el.style.left).toBe(`${xForTick(6)}px`);
    expect(el.classList.contains('playing')).toBe(true);      // untouched
    expect(stage.querySelector('[data-id="2"]')).toBe(null);
  });

  it('noteEl(id) exposes the keyed span for the lane (shake, playhead highlight)', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([{ tick: 0, string: 0, fret: 12 }]), UI);
    expect(r.noteEl(1)).toBe(stage.querySelector('[data-id="1"]'));
    expect(r.noteEl(99)).toBe(null);
  });
});

describe('bars + width from the time signature', () => {
  it('4/4 bars every 48 ticks, numbered from 2 (bar 1 has no line at x=0)', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([{ tick: 90, string: 0, fret: 0 }]), UI);    // forces ≥ 2 bars of width
    const bars = [...stage.querySelectorAll('.tab-bar')];
    const nums = [...stage.querySelectorAll('.tab-barnum')];
    expect(bars[0].style.left).toBe(`${(48 / 3) * COL_W}px`);       // 416px
    expect(nums[0].textContent).toBe('2');
    expect(nums[0].style.left).toBe(`${(48 / 3) * COL_W + 3}px`);
  });

  it('3/4 re-bars the same ticks at 36; re-render with same key is a no-op rebuild', () => {
    const r = createTabRenderer(stage);
    const s = stateWith([{ tick: 90, string: 0, fret: 0 }], { num: 3, den: 4 });
    r.render(s, UI);
    const first = stage.querySelector('.tab-bar');
    expect(first.style.left).toBe(`${(36 / 3) * COL_W}px`);         // 312px
    r.render(s, UI);                                                // same TS + width
    expect(stage.querySelector('.tab-bar')).toBe(first);            // not rebuilt
  });

  it('stage width covers whole bars past the content, plus one spare bar to type into', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([]), UI);
    expect(stage.style.width).toBe(`${(96 / 3) * COL_W + 40}px`);       // 2 empty bars
    r.render(stateWith([{ tick: 96, string: 0, fret: 0, durTicks: 12 }]), UI);
    expect(stage.style.width).toBe(`${(192 / 3) * COL_W + 40}px`);      // 3 bars content + 1 spare
    r.render(stateWith([]), { ...UI, cursor: { tick: 120, string: 0 } });
    expect(stage.style.width).toBe(`${(192 / 3) * COL_W + 40}px`);      // cursor keeps room too
  });
});

describe('overlays', () => {
  it('cursor cell shows at the cell and hides when null', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([]), { ...UI, cursor: { tick: 6, string: 2 } });
    const c = stage.querySelector('.tab-cell-cursor');
    expect(c.style.display).not.toBe('none');
    expect(c.style.left).toBe(`${xForTick(6)}px`);
    expect(c.style.top).toBe(`${yForString(2)}px`);
    r.render(stateWith([]), UI);
    expect(c.style.display).toBe('none');
  });

  it('selection band spans [start, end) columns, normalized', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([]), { ...UI, selection: { startTick: 12, endTick: 3 } });   // reversed on purpose
    const sel = stage.querySelector('.tab-selection');
    expect(sel.style.display).not.toBe('none');
    expect(sel.style.left).toBe(`${(3 / 3) * COL_W}px`);
    expect(sel.style.width).toBe(`${(9 / 3) * COL_W}px`);
    r.render(stateWith([]), UI);
    expect(sel.style.display).toBe('none');
  });
});

describe('wrapped layout (bars flow into rows like paper tab)', () => {
  const mountWrapped = (notes, viewWidth = 500) => {
    const r = createTabRenderer(stage, { getViewWidth: () => viewWidth });
    r.render(stateWith(notes), UI);
    return r;
  };

  it('one bar per 500px row: bar 2 lands on row 1, same x as bar 1', () => {
    const r = mountWrapped([{ tick: 48, string: 2, fret: 5 }]);         // bar 2, G string
    const layout = r.getLayout();
    expect(layout.ticksPerRow).toBe(48);
    expect(layout.rows).toBe(3);                                        // 2 content bars + 1 spare
    const el = stage.querySelector('.tab-note[data-id="1"]');
    expect(el.style.left).toBe(`${xForTick(0)}px`);                     // x wraps back to column 0
    expect(el.style.top).toBe(`${ROW_H + 2 * LINE_GAP}px`);             // row 1, string 2
  });

  it('cellAt inverts pointFor across rows (input clicks land on the right bar)', () => {
    const r = mountWrapped([]);
    const layout = r.getLayout();
    const p = layout.pointFor(60, 3);                                   // bar 2, col 4
    expect(p.row).toBe(1);
    expect(layout.cellAt(p.x, p.y)).toEqual({ tick: 60, string: 3 });
    expect(layout.cellAt(13, 5)).toEqual({ tick: 0, string: 0 });
  });

  it('string lines repeat per row; row starts get numbers, not lines', () => {
    mountWrapped([{ tick: 48, string: 0, fret: 0 }]);
    expect(stage.querySelectorAll('.tab-lines i')).toHaveLength(18);    // 3 rows × 6 strings
    const nums = [...stage.querySelectorAll('.tab-barnum')].map((n) => [n.textContent, n.style.top]);
    expect(nums).toContainEqual(['2', `${ROW_H - 2}px`]);               // bar 2 at row 1's head
    expect(stage.querySelectorAll('.tab-bar')).toHaveLength(0);         // no internal boundaries at 1 bar/row
  });

  it('a selection spanning rows renders one rectangle per row', () => {
    const r = createTabRenderer(stage, { getViewWidth: () => 500 });
    r.render(stateWith([]), { ...UI, selection: { startTick: 24, endTick: 72 } });
    const rects = stage.querySelectorAll('.tab-selection');
    expect(rects).toHaveLength(2);
    expect(rects[0].style.left).toBe(`${(24 / 3) * COL_W}px`);          // row 0 tail
    expect(rects[0].style.width).toBe(`${(24 / 3) * COL_W}px`);
    expect(rects[1].style.top).toBe(`${ROW_H - 4}px`);                  // row 1 head
    expect(rects[1].style.width).toBe(`${(24 / 3) * COL_W}px`);
  });

  it('stems follow their note into the row (no absolute row-0 tops)', () => {
    mountWrapped([{ tick: 60, string: 0, fret: 0, durTicks: 12 }]);
    const stem = stage.querySelector('.tab-stem');
    expect(stem.style.top).toBe(`${ROW_H + 78}px`);
    expect(stem.style.left).toBe(`${xForTick(12)}px`);                  // col 4 within row 1
  });
});

describe('destroy', () => {
  it('removes everything it created', () => {
    const r = createTabRenderer(stage);
    r.render(stateWith([{ tick: 48, string: 1, fret: 3 }]), { ...UI, cursor: { tick: 0, string: 0 } });
    r.destroy();
    expect(stage.querySelectorAll('.tab-note, .tab-bar, .tab-barnum, .tab-cell-cursor, .tab-selection')).toHaveLength(0);
  });
});
