// src/tab/tab-render.js — draws a tab model onto the lane's stage element.
// Pure view: reads state + ui (cursor cell / selection band), owns the note
// spans, string lines, bar lines and overlays. Incremental — note spans are
// keyed by note id and only changed properties are touched, so a 16-bar lick
// re-renders in microseconds and playback highlighting (.playing, applied by
// the lane) survives re-renders.
//
// WRAPPED layout: like paper tab, the grid breaks into stacked rows of whole
// bars instead of scrolling horizontally forever. `getViewWidth()` supplies
// the available width; how many bars fit decides the row length, and every
// tick maps to a (row, x, y) through the layout object. When the width is
// unknown (jsdom tests, detached stages) the layout degrades to one endless
// row — exactly the classic single-strip geometry.

import { SIXTEENTH, PPQ, barTicks } from './tab-model.js';

export const COL_W = 26;          // px per 16th column
export const LINE_GAP = 15;       // px between string lines
export const ROW_H = 112;         // px per wrapped system row (strings + stems + bar numbers)

// Single-row primitives (row 0 of any layout; the historical geometry).
export function xForTick(tick) { return (tick / SIXTEENTH) * COL_W + COL_W / 2; }
export function tickForX(x) { return Math.max(0, Math.round((x - COL_W / 2) / COL_W)) * SIXTEENTH; }
export function yForString(s) { return s * LINE_GAP; }
export function stringForY(y) { return Math.max(0, Math.min(5, Math.round(y / LINE_GAP))); }

const isEdited = (n) => !!(n.det && (n.det.string !== n.string || n.det.fret !== n.fret));

export function createTabRenderer(stage, { getViewWidth = () => 0 } = {}) {
  const noteEls = new Map();      // note id -> span element

  const lines = document.createElement('div');
  lines.className = 'tab-lines';
  stage.appendChild(lines);

  const cellCursor = document.createElement('div');
  cellCursor.className = 'tab-cell-cursor';
  cellCursor.style.display = 'none';
  stage.appendChild(cellCursor);

  const selection = document.createElement('div');
  selection.className = 'tab-selection';
  selection.style.display = 'none';
  stage.appendChild(selection);

  // Extra selection rectangles when a selection spans wrapped rows.
  const selExtra = [];

  // Rhythm layer sits under the strings; pointer-events off so it never
  // steals clicks from cells or notes.
  const rhythm = document.createElement('div');
  rhythm.className = 'tab-rhythm';
  stage.appendChild(rhythm);

  // Technique glyph layer — pointer-events off so it never steals clicks.
  const glyphs = document.createElement('div');
  glyphs.className = 'tab-glyphs';
  stage.appendChild(glyphs);

  // ── Layout: tick ↔ (row, x, y) ──────────────────────────────────────────────
  // Rows break on whole-bar boundaries. ticksPerRow = Infinity means the
  // classic endless single strip (tests, unknown width).
  let layout = null;

  function computeLayout(state, ui) {
    const barT = barTicks(state.timeSig);
    const barPx = (barT / SIXTEENTH) * COL_W;
    const vw = getViewWidth();
    const barsPerRow = vw > 0 ? Math.max(1, Math.floor((vw - 50) / barPx)) : Infinity;
    const ticksPerRow = barsPerRow === Infinity ? Infinity : barsPerRow * barT;

    const lastEnd = state.notes.reduce((m, n) => Math.max(m, n.tick + n.durTicks), 0);
    const uiTick = ui && ui.cursor ? ui.cursor.tick : 0;
    const contentTicks = Math.max(lastEnd, uiTick + SIXTEENTH, 16 * SIXTEENTH);
    // always keep one spare bar of room to type into
    const totalTicks = (Math.ceil(contentTicks / barT) + 1) * barT;
    const rows = ticksPerRow === Infinity ? 1 : Math.ceil(totalTicks / ticksPerRow);

    return {
      barT, ticksPerRow, rows, totalTicks,
      rowOf(tick) { return ticksPerRow === Infinity ? 0 : Math.min(rows - 1, Math.floor(tick / ticksPerRow)); },
      // tick may be fractional (playhead riding between columns)
      pointFor(tick, string = 0) {
        const row = this.rowOf(tick);
        const rel = tick - row * (ticksPerRow === Infinity ? 0 : ticksPerRow);
        return { row, x: (rel / SIXTEENTH) * COL_W + COL_W / 2, y: row * ROW_H + string * LINE_GAP };
      },
      cellAt(x, y) {
        const row = ticksPerRow === Infinity ? 0 : Math.max(0, Math.min(rows - 1, Math.floor(y / ROW_H)));
        // clamp to the row's own bars — a click in the margin right of the
        // last bar belongs to THIS row's final column, not the next row
        const rel = ticksPerRow === Infinity
          ? tickForX(x)
          : Math.min(tickForX(x), ticksPerRow - SIXTEENTH);
        return { tick: row * (ticksPerRow === Infinity ? 0 : ticksPerRow) + rel, string: stringForY(y - row * ROW_H) };
      },
    };
  }

  let chromeKey = '';             // `${barT}:${ticksPerRow}:${rows}` — bars/lines rebuild key

  function renderChrome(state) {
    const key = `${layout.barT}:${layout.ticksPerRow}:${layout.rows}`;
    if (key === chromeKey) return;
    chromeKey = key;

    // string lines per row
    lines.textContent = '';
    for (let r = 0; r < layout.rows; r++) {
      for (let s = 0; s < 6; s++) {
        const i = document.createElement('i');
        i.style.top = `${r * ROW_H + s * LINE_GAP}px`;
        lines.appendChild(i);
      }
    }

    // bar lines + numbers. Internal boundaries get a line; every bar start
    // (including row starts, except bar 1) gets its number.
    stage.querySelectorAll('.tab-bar, .tab-barnum').forEach((el) => el.remove());
    const perRow = layout.ticksPerRow;
    for (let tick = layout.barT; tick < layout.totalTicks; tick += layout.barT) {
      const p = layout.pointFor(tick, 0);
      const atRowStart = perRow !== Infinity && tick % perRow === 0;
      if (!atRowStart) {
        const bar = document.createElement('i');
        bar.className = 'tab-bar';
        bar.style.left = `${p.x - COL_W / 2}px`;
        bar.style.top = `${p.row * ROW_H - 3}px`;
        stage.appendChild(bar);
      }
      const num = document.createElement('span');
      num.className = 'tab-barnum';
      num.textContent = String(tick / layout.barT + 1);
      num.style.left = `${p.x - COL_W / 2 + 3}px`;
      num.style.top = `${p.row * ROW_H - 2}px`;
      stage.appendChild(num);
    }
  }

  function renderNotes(state) {
    const seen = new Set();
    for (const n of state.notes) {
      seen.add(n.id);
      let el = noteEls.get(n.id);
      if (!el) {
        el = document.createElement('span');
        el.className = 'tab-note';
        el.dataset.id = String(n.id);
        stage.appendChild(el);
        noteEls.set(n.id, el);
        requestAnimationFrame(() => el.classList.add('in'));
      }
      // never rewrite className wholesale — the lane owns .playing, glyphs
      // own .dead, and the enter animation owns .in
      const label = String(n.fret);
      if (!el.querySelector('input') && el.textContent !== label) el.textContent = label;
      const p = layout.pointFor(n.tick, n.string);
      const left = `${p.x}px`;
      const top = `${p.y}px`;
      if (el.style.left !== left) el.style.left = left;
      if (el.style.top !== top) el.style.top = top;
      el.classList.toggle('edited', isEdited(n));
    }
    for (const [id, el] of noteEls) {
      if (!seen.has(id)) { el.remove(); noteEls.delete(id); }
    }
  }

  function renderOverlays(ui) {
    if (ui && ui.cursor) {
      const p = layout.pointFor(ui.cursor.tick, ui.cursor.string);
      cellCursor.style.display = '';
      cellCursor.style.left = `${p.x}px`;
      cellCursor.style.top = `${p.y}px`;
    } else {
      cellCursor.style.display = 'none';
    }

    for (const el of selExtra) el.remove();
    selExtra.length = 0;
    if (ui && ui.selection) {
      const a = Math.min(ui.selection.startTick, ui.selection.endTick);
      const b = Math.max(ui.selection.startTick, ui.selection.endTick);
      const rowA = layout.rowOf(a);
      const rowB = layout.rowOf(Math.max(a, b - 1));
      const rect = (el, row, from, to) => {
        const rowBase = row * (layout.ticksPerRow === Infinity ? 0 : layout.ticksPerRow);
        el.style.display = '';
        el.style.left = `${((from - rowBase) / SIXTEENTH) * COL_W}px`;
        el.style.width = `${((to - from) / SIXTEENTH) * COL_W}px`;
        el.style.top = `${row * ROW_H - 4}px`;
      };
      rect(selection, rowA, a, rowA === rowB ? b : (rowA + 1) * layout.ticksPerRow);
      for (let r = rowA + 1; r <= rowB; r++) {
        const el = document.createElement('div');
        el.className = 'tab-selection';
        stage.appendChild(el);
        selExtra.push(el);
        rect(el, r, r * layout.ticksPerRow, r === rowB ? b : (r + 1) * layout.ticksPerRow);
      }
    } else {
      selection.style.display = 'none';
    }
  }

  // ── Rhythm layer: stems/beams/dots (Guitar Pro style) ──────────────────────
  // One stem per occupied 16th column below the strings, flags/beams by value,
  // dot for dotted. Rebuilt wholesale on every render — beams span columns so
  // there is no per-note identity to preserve, and a lick is at most a few
  // hundred columns (cheap next to the keyed note reconcile above).
  const FLAG_COUNT = { 3: 2, 6: 1, 9: 1 };     // 16th, 8th, dotted-8th; ≥ quarter has none
  const STEM_TOP = 78, BEAM_TOP = 86, BEAM_LVL = 3, FLAG_W = 12;

  const beamEl = (a, b, level) => {
    const pa = layout.pointFor(a, 0), pb = layout.pointFor(b, 0);
    const el = document.createElement('i');
    el.className = 'tab-beam';
    el.style.left = `${pa.x}px`;
    el.style.width = `${pb.x - pa.x}px`;
    el.style.top = `${pa.row * ROW_H + BEAM_TOP - level * BEAM_LVL}px`;
    return el;
  };
  const flagEl = (tick, level) => {
    const p = layout.pointFor(tick, 0);
    const el = document.createElement('i');
    el.className = 'tab-beam flag';
    el.style.left = `${p.x}px`;
    el.style.width = `${FLAG_W}px`;
    el.style.top = `${p.row * ROW_H + BEAM_TOP - level * BEAM_LVL}px`;
    return el;
  };

  function renderRhythm(state) {
    rhythm.textContent = '';
    const cols = new Map();                    // tick -> shortest duration (chords share a stem)
    for (const n of state.notes) {
      const cur = cols.get(n.tick);
      if (cur == null || n.durTicks < cur) cols.set(n.tick, n.durTicks);
    }
    const ticks = [...cols.keys()].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();
    let carried = 0;                           // beam levels drawn INTO column i by i−1
    for (let i = 0; i < ticks.length; i++) {
      const tick = ticks[i], dur = cols.get(tick);
      const p = layout.pointFor(tick, 0);
      if (dur < 48) {                          // whole notes carry no stem
        const stem = document.createElement('i');
        stem.className = 'tab-stem' + (dur >= 24 ? ' short' : '');
        stem.style.left = `${p.x}px`;
        stem.style.top = `${p.row * ROW_H + STEM_TOP}px`;
        frag.appendChild(stem);
      }
      if (dur === 36 || dur === 18 || dur === 9) {
        const dot = document.createElement('i');
        dot.className = 'tab-dot';
        dot.style.left = `${p.x + 4}px`;
        dot.style.top = `${p.row * ROW_H + 85}px`;
        frag.appendChild(dot);
      }
      const flags = FLAG_COUNT[dur] || 0;
      let joined = 0;
      if (flags) {
        const next = ticks[i + 1];
        const nextFlags = next != null ? (FLAG_COUNT[cols.get(next)] || 0) : 0;
        // beam only when the next column starts exactly where this note ends
        // AND both sit inside the same quarter-note beat (a beat never spans
        // a bar, so beam partners always share a row)
        if (nextFlags && next === tick + dur && Math.floor(tick / PPQ) === Math.floor(next / PPQ)) {
          joined = Math.min(flags, nextFlags);
          for (let l = 0; l < joined; l++) frag.appendChild(beamEl(tick, next, l));
        }
        // levels not covered by an in- or out-going beam render as short flags
        for (let l = Math.max(carried, joined); l < flags; l++) frag.appendChild(flagEl(tick, l));
      }
      carried = joined;
    }
    rhythm.appendChild(frag);
  }

  // ── Technique glyphs (Guitar Pro-style tab marks) ───────────────────────────
  // h/p slur arc from the previous note on the string, / \ slide dash, bend
  // amount above the note, PM―― span over palm-muted runs. Rebuilt wholesale
  // per render. Rows clamp their own headroom (the ~4px above string 0).
  function renderGlyphs(state) {
    glyphs.textContent = '';
    const frag = document.createDocumentFragment();
    const sorted = [...state.notes].sort((a, b) => a.tick - b.tick || a.string - b.string);

    // dead: × replaces the fret number on the note span itself. Adjusted in
    // BOTH directions so a stale × never survives an un-toggle, and never
    // while an inline fret edit is open inside the span.
    for (const n of sorted) {
      const el = noteEls.get(n.id);
      if (!el || el.querySelector('input')) continue;
      const dead = !!(n.tech && n.tech.dead);
      const label = dead ? '×' : String(n.fret);
      if (el.textContent !== label) el.textContent = label;
      el.classList.toggle('dead', dead);
    }

    const byString = new Map();
    for (const n of sorted) {
      if (!byString.has(n.string)) byString.set(n.string, []);
      byString.get(n.string).push(n);
    }

    for (const [s, list] of byString) {
      for (let i = 0; i < list.length; i++) {
        const n = list[i], t = n.tech || {};
        const p = layout.pointFor(n.tick, s);
        const rowTop = p.row * ROW_H;
        const headClamp = (v) => Math.max(rowTop - 4, v);
        if (t.hp) {
          // slur arc from the previous note on the string; a phrase-opening
          // hammer/pull — or one whose partner sits on the previous row —
          // gets a half-column stub arc instead
          const prev = i > 0 ? list[i - 1] : null;
          const sameRow = prev && layout.rowOf(prev.tick) === p.row;
          const from = sameRow ? layout.pointFor(prev.tick, s).x + 5 : p.x - COL_W / 2;
          const el = document.createElement('i');
          el.className = 'tab-glyph hp';
          el.dataset.t = t.hp;
          el.style.left = `${from}px`;
          el.style.width = `${Math.max(8, p.x - 5 - from)}px`;
          el.style.top = `${headClamp(p.y - 11)}px`;
          frag.appendChild(el);
        }
        if (t.slide) {
          const el = document.createElement('i');
          el.className = `tab-glyph slide ${t.slide === '/' ? 'up' : 'down'}`;
          el.style.left = `${p.x + 7}px`;
          el.style.top = `${p.y - 3}px`;
          frag.appendChild(el);
        }
        if (t.bend) {
          const el = document.createElement('i');
          el.className = 'tab-glyph bend';
          el.textContent = t.bend === 1 ? 'full' : '½';
          el.style.left = `${p.x + 6}px`;
          el.style.top = `${headClamp(p.y - 13)}px`;
          frag.appendChild(el);
        }
      }
    }

    // PM―― spans: palm-muted runs chain while consecutive muted columns are
    // at most a beat apart AND share a row; drawn in the bar-number band.
    const pmTicks = [...new Set(sorted.filter((n) => n.tech && n.tech.pm).map((n) => n.tick))];
    for (let i = 0; i < pmTicks.length; i++) {
      const start = pmTicks[i];
      const row = layout.rowOf(start);
      let last = start;
      while (i + 1 < pmTicks.length && pmTicks[i + 1] - pmTicks[i] <= PPQ && layout.rowOf(pmTicks[i + 1]) === row) {
        i++; last = pmTicks[i];
      }
      const pa = layout.pointFor(start, 0), pb = layout.pointFor(last, 0);
      const el = document.createElement('i');
      el.className = 'tab-glyph pm';
      el.textContent = 'PM';
      el.style.left = `${pa.x - 6}px`;
      el.style.width = `${Math.max(18, pb.x - pa.x + 12)}px`;
      el.style.top = `${row * ROW_H - 4}px`;
      frag.appendChild(el);
    }
    glyphs.appendChild(frag);
  }

  function render(state, ui) {
    layout = computeLayout(state, ui);
    if (layout.ticksPerRow === Infinity) {
      const cols = layout.totalTicks / SIXTEENTH;
      stage.style.width = `${cols * COL_W + 40}px`;
      stage.style.height = '';
    } else {
      stage.style.width = '';                          // min-width:100% from CSS
      stage.style.height = `${layout.rows * ROW_H - 10}px`;
    }
    renderChrome(state);
    renderNotes(state);
    renderOverlays(ui);
    renderRhythm(state);
    renderGlyphs(state);
    return layout;
  }

  function noteEl(id) { return noteEls.get(id) || null; }
  function getLayout() { return layout; }

  function destroy() {
    stage.querySelectorAll('.tab-bar, .tab-barnum').forEach((el) => el.remove());
    for (const el of noteEls.values()) el.remove();
    noteEls.clear();
    for (const el of selExtra) el.remove();
    lines.remove();
    cellCursor.remove();
    selection.remove();
    rhythm.remove();
    glyphs.remove();
  }

  return { render, noteEl, getLayout, destroy };
}
