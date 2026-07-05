// src/tab/tab-input.js — pointer + keyboard controller for the tab editor.
// Translates gestures into tab-model ops; owns the grid cursor, the range
// selection and the pending-digit state. Zero rendering — after ui-only
// changes it calls requestRender(); model mutations re-render through the
// model's own subscribe pipeline.
//
// Keyboard map (active while the stage has focus):
//   0-9            type a fret at the cursor; a second digit within 600 ms
//                  combines to 10–24 (Guitar Pro convention)
//   arrows         move the cursor (16th steps / strings)
//   Shift+←/→      extend the selection by columns
//   Del/Backspace  delete selection or the note at the cursor
//   Ctrl/Cmd+Z     undo · Ctrl/Cmd+Shift+Z redo
//   Ctrl/Cmd+C/V   copy the selection / paste at the cursor
//   Escape         drop the selection
//
// Pointer: click empty cell = cursor; click note = select it; drag a note
// vertically = string move (pitch preserved, shake on reject), horizontally
// = time move (snapped to the grid); drag on empty = range selection;
// double-click a note = inline fret edit (lane owns the input element).

import { SIXTEENTH, DURATIONS } from './tab-model.js';
import { tickForX, stringForY, xForTick, yForString } from './tab-render.js';
import { can } from '../features.js';

const DRAG_THRESH = 4;            // px before a pointerdown counts as a drag
const DIGIT_MS = 600;             // window to combine two digits into 10–24

export function attachTabInput({ scrollEl, stage, model, ui, requestRender, onEditFret }) {
  stage.tabIndex = 0;             // stage receives keyboard focus

  let clipboard = null;           // copyRange payload
  let selAnchor = null;           // tick where a Shift-selection started
  let pending = null;             // { id, fret, timer } — one-digit state

  const noteAt = (tick, string) =>
    model.getState().notes.find((n) => n.tick === tick && n.string === string);

  // ids inside the selection, [startTick, endTick) — null when no selection
  const selectedIds = () => {
    if (!ui.selection) return null;
    const a = Math.min(ui.selection.startTick, ui.selection.endTick);
    const b = Math.max(ui.selection.startTick, ui.selection.endTick);
    return model.getState().notes.filter((n) => n.tick >= a && n.tick < b).map((n) => n.id);
  };

  const flushPendingDigit = () => {
    if (!pending) return;
    clearTimeout(pending.timer);
    pending = null;
  };

  function typeDigit(d) {
    if (!can('tab.edit') || !ui.cursor) return;
    if (pending) {
      const combined = pending.fret * 10 + d;
      if (combined <= 24) {                       // 10–24: amend the note just typed
        const id = pending.id;
        flushPendingDigit();
        model.setFret(id, combined);
        return;
      }
      flushPendingDigit();                        // out of range → d starts fresh
    }
    const id = model.addNote({ tick: ui.cursor.tick, string: ui.cursor.string, fret: d, durTicks: ui.currentDur });
    if (id == null) return;
    if (d >= 1 && d <= 2) {                       // only 1x/2x can still combine to ≤24
      pending = { id, fret: d, timer: setTimeout(() => { pending = null; }, DIGIT_MS) };
    }
  }

  function moveCursor(dTick, dString, extend) {
    if (!ui.cursor) {
      ui.cursor = { tick: 0, string: 0 };
      if (extend) selAnchor = 0;
    } else {
      if (extend && selAnchor == null) selAnchor = ui.cursor.tick;
      ui.cursor = {
        tick: Math.max(0, ui.cursor.tick + dTick * SIXTEENTH),
        string: Math.max(0, Math.min(5, ui.cursor.string + dString)),
      };
    }
    if (extend) {
      ui.selection = {
        startTick: Math.min(selAnchor, ui.cursor.tick),
        endTick: Math.max(selAnchor, ui.cursor.tick) + SIXTEENTH,
      };
    } else {
      ui.selection = null;
      selAnchor = null;
    }
    requestRender();
  }

  // ── Duration keys ───────────────────────────────────────────────────────────
  const DUR_KEYS = { q: 48, w: 24, e: 12, r: 6, t: 3 };
  // Dotted variant when one exists (24→36), un-dot when already dotted (36→24).
  // Whole (72) and dotted-16th (4.5) are not DURATIONS members → no-op.
  const toggleDot = (d) => {
    if (DURATIONS.includes(d * 1.5)) return d * 1.5;
    if (Number.isInteger(d / 1.5) && DURATIONS.includes(d / 1.5)) return d / 1.5;
    return d;
  };

  function applyDuration(dur) {
    ui.currentDur = dur;
    const ids = selectedIds();
    if (ids && ids.length) model.setDuration(ids, dur);   // model change renders via subscribe
    else requestRender();                                  // ui-only change
  }

  function applyDot() {
    ui.currentDur = toggleDot(ui.currentDur);
    const ids = selectedIds();
    if (ids && ids.length) {
      // per-note toggle: a mixed selection dots each note relative to itself.
      // One setDuration call per target value; mixed selections cost extra
      // undo steps — rare enough to accept.
      const idSet = new Set(ids);
      const byTarget = new Map();
      for (const n of model.getState().notes) {
        if (!idSet.has(n.id)) continue;
        const next = toggleDot(n.durTicks);
        if (next === n.durTicks) continue;
        if (!byTarget.has(next)) byTarget.set(next, []);
        byTarget.get(next).push(n.id);
      }
      for (const [dur, group] of byTarget) model.setDuration(group, dur);
    } else requestRender();
  }

  // ── Technique keys ──────────────────────────────────────────────────────────
  // h/p hammer-on/pull-off, / \ slides, b bend cycle (½ → full → off), x dead
  // note, m palm mute. Applies to the selection, else the note under the
  // cursor. toggleTech is a per-note toggle, so the same key clears the mark.
  const TECH_KEYS = {
    h: ['hp', 'h'], p: ['hp', 'p'],
    '/': ['slide', '/'], '\\': ['slide', '\\'],
    b: ['bend', null],                  // value resolved by the cycle below
    x: ['dead', true], m: ['pm', true],
  };
  const techTargets = () => {
    const ids = selectedIds();
    if (ids && ids.length) return ids;
    if (!ui.cursor) return null;
    const at = model.getState().notes.find((n) => n.tick === ui.cursor.tick && n.string === ui.cursor.string);
    return at ? [at.id] : null;
  };

  function applyTech(k) {
    const ids = techTargets();
    if (!ids) return;
    const [key, value] = TECH_KEYS[k];
    if (key === 'bend') {
      // cycle keyed off the first target's current value: off → ½ → full →
      // off (a set bend + value 1 replaces; value 1 twice toggles off)
      const first = model.getState().notes.find((n) => n.id === ids[0]);
      model.toggleTech(ids, 'bend', first && first.tech.bend ? 1 : 0.5);
    } else {
      model.toggleTech(ids, key, value);
    }
  }

  function deleteAtCursor() {
    if (!can('tab.edit')) return;
    const ids = selectedIds();
    if (ids && ids.length) {
      model.deleteNotes(ids);
      ui.selection = null;
      selAnchor = null;
      requestRender();
      return;
    }
    if (ui.selection) { ui.selection = null; selAnchor = null; requestRender(); return; }
    if (!ui.cursor) return;
    const n = noteAt(ui.cursor.tick, ui.cursor.string);
    if (n) model.deleteNotes([n.id]);
  }

  function onKeydown(e) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault(); e.stopPropagation();
      flushPendingDigit();
      if (e.shiftKey) model.redo(); else model.undo();
      return;
    }
    if (mod && (e.key === 'c' || e.key === 'C')) {
      if (!ui.selection) return;
      e.preventDefault(); e.stopPropagation();
      const a = Math.min(ui.selection.startTick, ui.selection.endTick);
      const b = Math.max(ui.selection.startTick, ui.selection.endTick);
      clipboard = model.copyRange(a, b);
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V')) {
      e.preventDefault(); e.stopPropagation();
      if (!can('tab.edit') || !clipboard || !ui.cursor) return;
      model.pasteAt(ui.cursor.tick, clipboard);
      return;
    }
    if (mod) return;                              // other shortcuts belong to the app

    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); e.stopPropagation(); flushPendingDigit(); moveCursor(-1, 0, e.shiftKey); return;
      case 'ArrowRight': e.preventDefault(); e.stopPropagation(); flushPendingDigit(); moveCursor(1, 0, e.shiftKey); return;
      case 'ArrowUp':    e.preventDefault(); e.stopPropagation(); flushPendingDigit(); moveCursor(0, -1, false); return;
      case 'ArrowDown':  e.preventDefault(); e.stopPropagation(); flushPendingDigit(); moveCursor(0, 1, false); return;
      case 'Delete':
      case 'Backspace':  e.preventDefault(); e.stopPropagation(); flushPendingDigit(); deleteAtCursor(); return;
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        flushPendingDigit();
        ui.selection = null; selAnchor = null;
        requestRender();
        return;
      default: break;
    }
    if (DUR_KEYS[e.key] != null && can('tab.edit')) {
      e.preventDefault(); e.stopPropagation();
      flushPendingDigit();
      applyDuration(DUR_KEYS[e.key]);
      return;
    }
    if (e.key === '.' && can('tab.edit')) {
      e.preventDefault(); e.stopPropagation();
      flushPendingDigit();
      applyDot();
      return;
    }
    if (TECH_KEYS[e.key]) {
      e.preventDefault(); e.stopPropagation();
      if (!can('tab.techniques')) return;
      flushPendingDigit();
      applyTech(e.key);
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault(); e.stopPropagation();
      typeDigit(Number(e.key));
    }
  }

  // ── pointer ─────────────────────────────────────────────────────────────────
  // One pointerdown flow for both worlds: dragging a NOTE moves it (string =
  // pitch-preserving, tick = snapped time), dragging EMPTY sweeps a column
  // selection. jsdom has no pointer capture — guarded.
  let press = null;               // { kind:'note'|'stage', x0, y0, el?, id?, dragging }

  const cellFromEvent = (e) => {
    const rect = stage.getBoundingClientRect();
    return { tick: tickForX(e.clientX - rect.left), string: stringForY(e.clientY - rect.top) };
  };

  function shake(el) {
    if (!el) return;
    el.classList.remove('invalid');
    void el.offsetWidth;                          // restart the animation on repeat rejects
    el.classList.add('invalid');
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const noteEl = e.target && e.target.closest ? e.target.closest('.tab-note') : null;
    if (noteEl && noteEl.querySelector('input')) return;          // inline edit open — leave it alone
    try { stage.setPointerCapture(e.pointerId); } catch { /* jsdom / mouse */ }
    press = noteEl
      ? { kind: 'note', el: noteEl, id: Number(noteEl.dataset.id), x0: e.clientX, y0: e.clientY, dragging: false }
      : { kind: 'stage', x0: e.clientX, y0: e.clientY, dragging: false };
    stage.focus();
  }

  function onPointerMove(e) {
    if (!press) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) < DRAG_THRESH) return;
    press.dragging = true;
    const cell = cellFromEvent(e);
    if (press.kind === 'note') {
      // live preview only — state moves on release, render restores truth
      press.el.style.left = `${xForTick(cell.tick)}px`;
      press.el.style.top = `${yForString(cell.string)}px`;
      press.cell = cell;
    } else {
      const from = cellFromEvent({ clientX: press.x0, clientY: press.y0 });
      ui.selection = { startTick: Math.min(from.tick, cell.tick), endTick: Math.max(from.tick, cell.tick) + SIXTEENTH };
      requestRender();
    }
  }

  function onPointerUp(e) {
    if (!press) return;
    const p = press;
    press = null;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* jsdom / mouse */ }
    if (p.kind === 'note') {
      const n = model.getState().notes.find((k) => k.id === p.id);
      if (!p.dragging) {
        if (n) { ui.cursor = { tick: n.tick, string: n.string }; ui.selection = null; selAnchor = null; }
        requestRender();
        return;
      }
      const cell = p.cell || cellFromEvent(e);
      const moved = can('tab.edit') && model.moveNote(p.id, { tick: cell.tick, string: cell.string });
      if (!moved) shake(p.el);
      requestRender();                            // snap preview back to state truth
      return;
    }
    // stage press: click = place cursor; drag = selection already live
    if (!p.dragging) {
      ui.cursor = cellFromEvent(e);
      ui.selection = null;
      selAnchor = null;
    }
    requestRender();
  }

  function onDblClick(e) {
    const noteEl = e.target && e.target.closest ? e.target.closest('.tab-note') : null;
    if (!noteEl) return;
    e.preventDefault();
    onEditFret(Number(noteEl.dataset.id));
  }

  stage.addEventListener('keydown', onKeydown);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('dblclick', onDblClick);

  return {
    selectedIds,
    __flushPendingDigit: flushPendingDigit,
    destroy() {
      flushPendingDigit();
      stage.removeEventListener('keydown', onKeydown);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('dblclick', onDblClick);
    },
  };
}
