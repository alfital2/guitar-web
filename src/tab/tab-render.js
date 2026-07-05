// src/tab/tab-render.js — draws a tab model onto the lane's stage element.
// Pure view: reads state + ui (cursor cell / selection band), owns the note
// spans, bar lines and overlays. Incremental — note spans are keyed by note
// id and only changed properties are touched, so a 16-bar lick re-renders in
// microseconds and playback highlighting (.playing, applied by the lane)
// survives re-renders. Geometry is the same 16th-column grid the v1 lane
// used: COL_W px per 16th, LINE_GAP px between string lines.

import { SIXTEENTH, PPQ, barTicks } from './tab-model.js';

export const COL_W = 26;          // px per 16th column
export const LINE_GAP = 15;       // px between string lines

export function xForTick(tick) { return (tick / SIXTEENTH) * COL_W + COL_W / 2; }
export function tickForX(x) { return Math.max(0, Math.round((x - COL_W / 2) / COL_W)) * SIXTEENTH; }
export function yForString(s) { return s * LINE_GAP; }
export function stringForY(y) { return Math.max(0, Math.min(5, Math.round(y / LINE_GAP))); }

const isEdited = (n) => !!(n.det && (n.det.string !== n.string || n.det.fret !== n.fret));

export function createTabRenderer(stage) {
  const noteEls = new Map();      // note id -> span element

  // Overlays are created once; render() moves/hides them. The cursor cell
  // sits UNDER notes (a click target highlight), the selection band spans
  // the whole strip height.
  const cellCursor = document.createElement('div');
  cellCursor.className = 'tab-cell-cursor';
  cellCursor.style.display = 'none';
  stage.appendChild(cellCursor);

  const selection = document.createElement('div');
  selection.className = 'tab-selection';
  selection.style.display = 'none';
  stage.appendChild(selection);

  // Rhythm layer sits under the strings; pointer-events off so it never
  // steals clicks from cells or notes.
  const rhythm = document.createElement('div');
  rhythm.className = 'tab-rhythm';
  stage.appendChild(rhythm);

  let barKey = '';                // `${barTicks}:${cols}` — bars rebuild only when this changes

  function renderBars(state, cols) {
    const bt = barTicks(state.timeSig);
    const key = `${bt}:${cols}`;
    if (key === barKey) return;
    barKey = key;
    stage.querySelectorAll('.tab-bar, .tab-barnum').forEach((el) => el.remove());
    for (let tick = bt; tick < cols * SIXTEENTH; tick += bt) {
      const x = (tick / SIXTEENTH) * COL_W;             // column boundary, not center
      const bar = document.createElement('i');
      bar.className = 'tab-bar';
      bar.style.left = `${x}px`;
      stage.appendChild(bar);
      const num = document.createElement('span');
      num.className = 'tab-barnum';
      num.textContent = String(tick / bt + 1);
      num.style.left = `${x + 3}px`;
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
      // never rewrite className wholesale — the lane owns .playing, phase-5
      // glyphs own .dead, and the enter animation owns .in
      const label = String(n.fret);
      if (!el.querySelector('input') && el.textContent !== label) el.textContent = label;
      const left = `${xForTick(n.tick)}px`;
      const top = `${yForString(n.string)}px`;
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
      cellCursor.style.display = '';
      cellCursor.style.left = `${xForTick(ui.cursor.tick)}px`;
      cellCursor.style.top = `${yForString(ui.cursor.string)}px`;
    } else {
      cellCursor.style.display = 'none';
    }
    if (ui && ui.selection) {
      const a = Math.min(ui.selection.startTick, ui.selection.endTick);
      const b = Math.max(ui.selection.startTick, ui.selection.endTick);
      selection.style.display = '';
      selection.style.left = `${(a / SIXTEENTH) * COL_W}px`;
      selection.style.width = `${((b - a) / SIXTEENTH) * COL_W}px`;
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
    const el = document.createElement('i');
    el.className = 'tab-beam';
    el.style.left = `${xForTick(a)}px`;
    el.style.width = `${xForTick(b) - xForTick(a)}px`;
    el.style.top = `${BEAM_TOP - level * BEAM_LVL}px`;
    return el;
  };
  const flagEl = (tick, level) => {
    const el = document.createElement('i');
    el.className = 'tab-beam flag';
    el.style.left = `${xForTick(tick)}px`;
    el.style.width = `${FLAG_W}px`;
    el.style.top = `${BEAM_TOP - level * BEAM_LVL}px`;
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
      if (dur < 48) {                          // whole notes carry no stem
        const stem = document.createElement('i');
        stem.className = 'tab-stem' + (dur >= 24 ? ' short' : '');
        stem.style.left = `${xForTick(tick)}px`;
        stem.style.top = `${STEM_TOP}px`;
        frag.appendChild(stem);
      }
      if (dur === 36 || dur === 18 || dur === 9) {
        const dot = document.createElement('i');
        dot.className = 'tab-dot';
        dot.style.left = `${xForTick(tick) + 4}px`;
        frag.appendChild(dot);
      }
      const flags = FLAG_COUNT[dur] || 0;
      let joined = 0;
      if (flags) {
        const next = ticks[i + 1];
        const nextFlags = next != null ? (FLAG_COUNT[cols.get(next)] || 0) : 0;
        // beam only when the next column starts exactly where this note ends
        // AND both sit inside the same quarter-note beat
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

  function render(state, ui) {
    const lastEnd = state.notes.reduce((m, n) => Math.max(m, n.tick + n.durTicks), 0);
    const uiTick = ui && ui.cursor ? ui.cursor.tick : 0;
    const cols = Math.max(16, Math.ceil(Math.max(lastEnd, uiTick) / SIXTEENTH) + 16);
    stage.style.width = `${cols * COL_W + 40}px`;
    renderBars(state, cols);
    renderNotes(state);
    renderOverlays(ui);
    renderRhythm(state);
  }

  function noteEl(id) { return noteEls.get(id) || null; }

  function destroy() {
    stage.querySelectorAll('.tab-bar, .tab-barnum').forEach((el) => el.remove());
    for (const el of noteEls.values()) el.remove();
    noteEls.clear();
    cellCursor.remove();
    selection.remove();
    rhythm.remove();
  }

  return { render, noteEl, destroy };
}
