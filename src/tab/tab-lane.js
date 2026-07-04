// src/tab/tab-lane.js — the TAB lane above the amp: a scrolling 6-line
// tablature grid, one column per 16th note, bar lines every 16 columns (4/4),
// with EDITABLE fret numbers. Detection (offline-transcribe.js) fills it; the
// player then corrects it by hand:
//
//   • DRAG a note up/down to another string — the PITCH is preserved and the
//     fret is recomputed for the new string (fret 5 on D → 0 on G). Rejected
//     with a shake if the pitch can't sit on the target string.
//   • DOUBLE-CLICK the number to type a new fret — that CHANGES the pitch
//     (a manual correction of a wrong detection).
//
// Every note remembers what the engine originally detected (detMidi/detString/
// detFret) alongside its current value, so a corrected tab is a labelled
// training example: input = the audio clip, label = the human-verified notes.
// serialize()/loadNotes() round-trip the model; onChange() fires after edits.

import { TUNING_MIDI, MAX_FRET, midiForPosition, fretForString } from './transcribe.js';

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
const COL_W = 26;         // px per 16th column
const LINE_GAP = 15;      // px between string lines
const DRAG_THRESH = 4;    // px before a pointerdown counts as a drag (vs a click)

export function mountTabLane(container, { bpm = 120 } = {}) {
  container.innerHTML = '';
  container.hidden = false;

  const head = document.createElement('div');
  head.className = 'tab-head';
  head.innerHTML = `
    <span class="tab-title">TAB <span class="tab-state">transcription</span></span>
    <span class="tab-meta">${bpm} BPM · 16th grid · standard tuning</span>
    <span class="tab-hint">drag a note between strings · double-click to edit</span>
    <span class="tab-spacer"></span>
    <button type="button" class="tab-export" title="Download audio + corrected notes as a training example">Export</button>
    <button type="button" class="tab-clear">Clear</button>
    <button type="button" class="tab-close" aria-label="Close tab lane">✕</button>`;

  const scroll = document.createElement('div');
  scroll.className = 'tab-scroll';
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  scroll.appendChild(stage);

  // String name gutter + the 6 lines.
  const gutter = document.createElement('div');
  gutter.className = 'tab-gutter';
  gutter.innerHTML = STRING_NAMES.map((n, i) => `<i style="top:${i * LINE_GAP}px">${n}</i>`).join('');
  const lines = document.createElement('div');
  lines.className = 'tab-lines';
  lines.innerHTML = STRING_NAMES.map((_, i) => `<i style="top:${i * LINE_GAP}px"></i>`).join('');
  stage.appendChild(lines);

  container.append(head, gutter, scroll);

  let cols = 0;
  const noteMap = new Map();       // id -> { id, el, col, string, fret, midi, det*, edited, tSec, durSec }
  let seq = 0;
  let bpmVal = bpm;
  let changeCb = null;
  const emitChange = () => { if (changeCb) changeCb(serialize()); };

  const ensureCols = (col) => {
    if (col + 4 <= cols) return;
    const target = col + 16;
    for (let c = cols; c < target; c++) {
      if (c > 0 && c % 16 === 0) {
        const bar = document.createElement('i');
        bar.className = 'tab-bar';
        bar.style.left = `${c * COL_W}px`;
        stage.appendChild(bar);
        const num = document.createElement('span');
        num.className = 'tab-barnum';
        num.textContent = String(c / 16 + 1);
        num.style.left = `${c * COL_W + 3}px`;
        stage.appendChild(num);
      }
    }
    cols = target;
    stage.style.width = `${cols * COL_W + 40}px`;
  };
  ensureCols(16);

  const place = (note) => {
    note.el.style.left = `${note.col * COL_W + COL_W / 2}px`;
    note.el.style.top = `${note.string * LINE_GAP}px`;
  };

  const shake = (note) => {
    note.el.classList.remove('invalid');
    // reflow so the animation restarts on repeat rejects
    void note.el.offsetWidth;
    note.el.classList.add('invalid');
  };

  // ── numeric edit (double-click) ────────────────────────────────────────────
  function beginEdit(note) {
    if (note.el.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'tab-note-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = String(note.fret);
    input.setAttribute('aria-label', 'Fret number');
    note.el.textContent = '';
    note.el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      const raw = input.value.trim();
      input.remove();
      if (save && /^\d{1,2}$/.test(raw)) {
        const f = parseInt(raw, 10);
        if (f >= 0 && f <= MAX_FRET) { applyFret(note, f); return; }
        shake(note);
      }
      note.el.textContent = String(note.fret);   // revert display
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      e.stopPropagation();                        // don't leak to app-level keys
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation()); // no drag from inside
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  // Typing a fret CHANGES the pitch (manual correction of a wrong detection).
  function applyFret(note, fret) {
    note.fret = fret;
    note.midi = midiForPosition(note.string, fret);
    note.edited = true;
    note.el.textContent = String(fret);
    note.el.classList.add('edited');
    place(note);
    emitChange();
  }

  // Moving to another string PRESERVES the pitch (fret recomputed). Returns
  // false (and shakes) when the pitch can't live on the target string.
  function moveToString(note, string) {
    if (string === note.string) return true;
    const fret = fretForString(note.midi, string);
    if (fret == null) { shake(note); return false; }
    note.string = string;
    note.fret = fret;
    note.edited = true;
    note.el.textContent = String(fret);
    note.el.classList.add('edited');
    place(note);
    emitChange();
    return true;
  }

  // ── drag (vertical → string reassignment) ──────────────────────────────────
  function attachDrag(note) {
    note.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const startX = e.clientX, startY = e.clientY;
      const stageTop = stage.getBoundingClientRect().top;
      let dragging = false;
      note.el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESH) return;
        dragging = true;
        note.el.classList.add('dragging');
        // follow the pointer vertically; snap-preview to the nearest line
        const rel = ev.clientY - stageTop;
        const s = Math.max(0, Math.min(TUNING_MIDI.length - 1, Math.round(rel / LINE_GAP)));
        note.el.style.top = `${s * LINE_GAP}px`;
      };
      const up = (ev) => {
        note.el.releasePointerCapture(e.pointerId);
        note.el.removeEventListener('pointermove', move);
        note.el.removeEventListener('pointerup', up);
        note.el.classList.remove('dragging');
        if (!dragging) return;                    // it was a click, not a drag
        const rel = ev.clientY - stageTop;
        const s = Math.max(0, Math.min(TUNING_MIDI.length - 1, Math.round(rel / LINE_GAP)));
        if (!moveToString(note, s)) place(note);  // reject → snap home
      };
      note.el.addEventListener('pointermove', move);
      note.el.addEventListener('pointerup', up);
    });
    note.el.addEventListener('dblclick', (e) => { e.preventDefault(); beginEdit(note); });
  }

  function addNote({ string, fret, col, midi, tSec, durSec, det }) {
    ensureCols(col);
    const el = document.createElement('span');
    el.className = 'tab-note';
    el.textContent = String(fret);
    const note = {
      id: ++seq, el, col, string, fret,
      midi: midi != null ? midi : midiForPosition(string, fret),
      detMidi: det ? det.midi : (midi != null ? midi : midiForPosition(string, fret)),
      detString: det ? det.string : string,
      detFret: det ? det.fret : fret,
      edited: !!(det && (det.string !== string || det.fret !== fret)),
      tSec: tSec == null ? null : tSec,
      durSec: durSec == null ? null : durSec,
    };
    el.dataset.id = String(note.id);
    if (note.edited) el.classList.add('edited');
    place(note);
    stage.appendChild(el);
    noteMap.set(note.id, note);
    attachDrag(note);
    requestAnimationFrame(() => el.classList.add('in'));
    scroll.scrollLeft = Math.max(0, (col + 3) * COL_W - scroll.clientWidth);
    return note.id;
  }

  const dump = (n) => ({
    id: n.id, col: n.col, string: n.string, fret: n.fret, midi: n.midi,
    detMidi: n.detMidi, detString: n.detString, detFret: n.detFret,
    edited: n.edited, tSec: n.tSec, durSec: n.durSec,
  });

  function serialize() {
    const notes = [...noteMap.values()].sort((a, b) => a.col - b.col || a.string - b.string).map(dump);
    return { bpm: bpmVal, tuning: 'EADGBE', notes };
  }

  function clear() {
    stage.querySelectorAll('.tab-note, .tab-bar, .tab-barnum').forEach((n) => n.remove());
    noteMap.clear();
    cols = 0; ensureCols(16); scroll.scrollLeft = 0;
  }

  function loadNotes(model) {
    clear();
    if (model && Array.isArray(model.notes)) {
      for (const n of model.notes) {
        addNote({
          string: n.string, fret: n.fret, col: n.col, midi: n.midi, tSec: n.tSec, durSec: n.durSec,
          det: { midi: n.detMidi, string: n.detString, fret: n.detFret },
        });
      }
    }
  }

  const api = {
    // Place a detected note. `meta` carries the pitch + timing so edits can
    // preserve it and the export can pair it with the audio.
    noteOn(string, fret, col, meta = {}) {
      return addNote({ string, fret, col, midi: meta.midi, tSec: meta.tSec, durSec: meta.durSec });
    },
    // Programmatic edits (also used by drag/dblclick + e2e).
    moveNoteToString(id, string) { const n = noteMap.get(id); return n ? moveToString(n, string) : false; },
    setNoteFret(id, fret) { const n = noteMap.get(id); if (!n) return false; if (fret < 0 || fret > MAX_FRET) return false; applyFret(n, fret); return true; },
    getNotes() { return [...noteMap.values()].sort((a, b) => a.col - b.col || a.string - b.string).map(dump); },
    serialize, loadNotes,
    setBpm(v) { bpmVal = v; const m = head.querySelector('.tab-meta'); if (m) m.textContent = `${v} BPM · 16th grid · standard tuning`; },
    clear,
    noteCount: () => noteMap.size,
    // Header state line (offline transcription only — no live cursor anymore).
    setLive(_on, label) {
      const st = head.querySelector('.tab-state');
      if (st && label) st.textContent = label;
    },
    onChange(cb) { changeCb = cb; },
    onExport(cb) { head.querySelector('.tab-export').addEventListener('click', cb); },
    onClear(cb) { head.querySelector('.tab-clear').addEventListener('click', () => { cb(); }); },
    onClose(cb) { head.querySelector('.tab-close').addEventListener('click', cb); },
    destroy() { container.innerHTML = ''; container.hidden = true; },
  };
  return api;
}
