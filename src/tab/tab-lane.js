// src/tab/tab-lane.js — the TAB lane above the amp, rebuilt as a real editor
// shell over the v2 stack: tab-model.js (pure musical-time state) →
// tab-render.js (incremental keyed DOM) → tab-input.js (pointer/keyboard).
// The lane owns the header strip, the string gutter, the playhead cursor,
// the inline fret editor, and the BACK-COMPAT api main.js and the training
// export were built on:
//
//   • noteOn(string, fret, col, meta)  — detection seeding (col = 16th column);
//     meta carries the engine's pitch + audio-time anchor into det{} so a
//     corrected tab stays a labelled training example.
//   • getNotes() — v1-shaped dumps (col/detMidi/edited/tSec…); serialize()
//     returns the v2 state (with a bpm alias); loadNotes() accepts v1 or v2.
//   • Programmatic seeding (noteOn/loadNotes/clear) does NOT fire onChange —
//     only real edits do, exactly like the v1 lane.
//
// Editing beyond the v1 pair (string drag / fret retype): click a cell and
// TYPE frets, arrows to move, Del, undo/redo, range select, copy/paste —
// all delegated to tab-input.js against the model.

import {
  createTabModel, TUNING_PRESETS, SIXTEENTH, MAX_FRET,
  ticksToSec, durTicksFromSec, midiAt,
} from './tab-model.js';
import { createTabRenderer, COL_W, LINE_GAP } from './tab-render.js';
import { attachTabInput } from './tab-input.js';
import { can } from '../features.js';
import { downloadLick, readLickFile, autosaveTab, loadAutosave, toAscii } from './tab-file.js';

const dash = '·';

export function mountTabLane(container, { bpm = 120 } = {}) {
  container.innerHTML = '';
  container.hidden = false;

  const head = document.createElement('div');
  head.className = 'tab-head';
  head.innerHTML = `
    <button type="button" class="tab-play" aria-label="Play tab as MIDI" title="Play the tab as MIDI notes">▶</button>
    <span class="tab-title">TAB <span class="tab-state">transcription</span></span>
    <span class="tab-meta"></span>
    <span class="tab-hint">type frets at the cursor ${dash} drag notes ${dash} ⌫ delete ${dash} ⌘Z undo</span>
    <span class="tab-practice"></span>
    <span class="tab-spacer"></span>
    <span class="tab-file-actions"></span>
    <button type="button" class="tab-export" title="Download audio + corrected notes as a training example">Export</button>
    <button type="button" class="tab-clear">Clear</button>
    <button type="button" class="tab-close" aria-label="Close tab lane">✕</button>`;

  const scroll = document.createElement('div');
  scroll.className = 'tab-scroll';
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  scroll.appendChild(stage);

  const gutter = document.createElement('div');
  gutter.className = 'tab-gutter';
  const lines = document.createElement('div');
  lines.className = 'tab-lines';
  lines.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<i style="top:${i * LINE_GAP}px"></i>`).join('');
  stage.appendChild(lines);

  // Playhead — ridden by the transport (real audio) and the tab MIDI player.
  const cursor = document.createElement('div');
  cursor.className = 'tab-cursor';
  cursor.style.opacity = '0';
  stage.appendChild(cursor);

  container.append(head, gutter, scroll);

  // ── model / renderer / input ────────────────────────────────────────────────
  const model = createTabModel({ tempo: bpm });
  const ui = { cursor: null, selection: null, currentDur: SIXTEENTH };
  const renderer = createTabRenderer(stage);

  let changeCb = null;
  let suppress = 0;               // >0 while seeding programmatically — no onChange
  let playIndex = [];             // [{id, t0, t1}] — playhead highlight windows

  const requestRender = () => renderer.render(model.getState(), ui);

  // ── Interactive meta: tempo click-to-edit + TS picker + tuning/capo ────────
  const TS_CHOICES = ['2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '3/8', '6/8', '7/8', '9/8', '12/8', '2/2'];
  function mountMeta() {
    const meta = head.querySelector('.tab-meta');
    meta.innerHTML = `
      <button type="button" class="tab-bpm" title="Tempo — click to edit"></button><span class="tab-unit">BPM</span>
      <span class="tab-sep">${dash}</span>
      <select class="tab-ts" aria-label="Time signature">${TS_CHOICES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
      <span class="tab-sep">${dash}</span>
      <span class="tab-tune-slot"></span>`;
    const bpmBtn = meta.querySelector('.tab-bpm');
    const tsSel = meta.querySelector('.tab-ts');
    const refresh = (s) => {
      if (!meta.querySelector('.tab-bpm-input')) bpmBtn.textContent = String(s.tempo);
      const v = `${s.timeSig.num}/${s.timeSig.den}`;
      if (tsSel.value !== v) {
        // a loaded file may use a TS outside the common list — add it on the fly
        if (![...tsSel.options].some((o) => o.value === v)) tsSel.add(new Option(v, v));
        tsSel.value = v;
      }
    };
    bpmBtn.addEventListener('click', () => {
      if (!can('tab.edit') || meta.querySelector('.tab-bpm-input')) return;
      const input = document.createElement('input');
      input.className = 'tab-bpm-input';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.value = String(model.getState().tempo);
      input.setAttribute('aria-label', 'Tempo (BPM)');
      bpmBtn.textContent = '';
      bpmBtn.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const commit = (save) => {
        if (done) return; done = true;
        const raw = input.value.trim();
        input.remove();
        if (save && /^\d{2,3}$/.test(raw)) model.setTempo(parseInt(raw, 10));  // model clamps 30–300
        bpmBtn.textContent = String(model.getState().tempo);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        e.stopPropagation();                      // don't leak to lane/app keys
      });
      input.addEventListener('blur', () => commit(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    tsSel.addEventListener('change', () => {
      if (!can('tab.edit')) { refresh(model.getState()); return; }
      const [num, den] = tsSel.value.split('/').map(Number);
      model.setTimeSig(num, den);
    });
    model.subscribe(refresh);
    refresh(model.getState());
  }

  // ── Tuning + capo pickers; gutter string names follow the tuning ───────────
  function mountTunePickers() {
    const slot = head.querySelector('.tab-tune-slot');
    slot.innerHTML = `
      <select class="tab-tuning" aria-label="Tuning">${Object.entries(TUNING_PRESETS)
        .map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('')}</select>
      <select class="tab-capo" aria-label="Capo fret">${Array.from({ length: 8 },
        (_, i) => `<option value="${i}">${i ? `capo ${i}` : 'no capo'}</option>`).join('')}</select>`;
    const tunSel = slot.querySelector('.tab-tuning');
    const capoSel = slot.querySelector('.tab-capo');
    const refresh = (s) => {
      tunSel.value = s.tuning;
      capoSel.value = String(s.capo);
      // gutter names in display order (high → low), same geometry as the lines
      gutter.innerHTML = TUNING_PRESETS[s.tuning].names
        .map((n, i) => `<i style="top:${i * LINE_GAP}px">${n}</i>`).join('');
    };
    tunSel.addEventListener('change', () => {
      if (!can('tab.edit')) { refresh(model.getState()); return; }
      model.setTuning(tunSel.value);
    });
    capoSel.addEventListener('change', () => {
      if (!can('tab.edit')) { refresh(model.getState()); return; }
      model.setCapo(parseInt(capoSel.value, 10));
    });
    model.subscribe(refresh);
    refresh(model.getState());
  }

  // Highlight windows prefer the DETECTED audio times (the recording is the
  // truth a transcribed tab rides along) and fall back to grid-derived times
  // for hand-entered notes. Rebuilt once per model change, not per frame.
  function rebuildPlayIndex(state) {
    playIndex = state.notes.map((n) => {
      const t0 = n.det && n.det.tSec != null ? n.det.tSec : ticksToSec(n.tick, state.tempo);
      const dur = n.det && n.det.durSec != null ? n.det.durSec : ticksToSec(n.durTicks, state.tempo);
      return { id: n.id, t0, t1: t0 + Math.max(dur || 0.25, 0.12) };
    });
  }

  function onModelChange(state) {
    renderer.render(state, ui);
    rebuildPlayIndex(state);
    if (!suppress && changeCb) changeCb(api.serialize());
  }
  model.subscribe(onModelChange);
  mountMeta();
  mountTunePickers();

  // ── inline fret editor (double-click a note) ────────────────────────────────
  function beginEdit(noteId) {
    const el = renderer.noteEl(noteId);
    const note = model.getState().notes.find((n) => n.id === noteId);
    if (!el || !note || el.querySelector('input')) return;
    const input = document.createElement('input');
    input.className = 'tab-note-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = String(note.fret);
    input.setAttribute('aria-label', 'Fret number');
    el.textContent = '';
    el.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      const raw = input.value.trim();
      input.remove();
      el.textContent = String(model.getState().notes.find((n) => n.id === noteId)?.fret ?? note.fret);
      if (save && /^\d{1,2}$/.test(raw)) {
        const f = parseInt(raw, 10);
        if (f >= 0 && f <= MAX_FRET) {
          if (model.setFret(noteId, f)) { el.textContent = String(f); return; }
        }
        shakeNote(noteId);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      e.stopPropagation();                        // don't leak into editor/app keys
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  function shakeNote(id) {
    const el = renderer.noteEl(id);
    if (!el) return;
    el.classList.remove('invalid');
    void el.offsetWidth;
    el.classList.add('invalid');
  }

  const input = attachTabInput({ scrollEl: scroll, stage, model, ui, requestRender, onEditFret: beginEdit });

  // ── playhead (transport audio OR the tab's own MIDI player) ────────────────
  function ensureWidthFor(x) {
    const w = parseInt(stage.style.width, 10) || 0;
    if (x + 60 > w) stage.style.width = `${x + 60 + 8 * COL_W}px`;
  }

  function setPlayhead(tSec) {
    if (tSec == null || tSec < 0) { hidePlayhead(); return; }
    const state = model.getState();
    const colF = tSec * (state.tempo / 60) * 4;          // seconds → 16th columns
    const x = colF * COL_W + COL_W / 2;
    ensureWidthFor(x);
    cursor.style.transform = `translateX(${x}px)`;
    cursor.style.opacity = '1';
    for (const w of playIndex) {
      const el = renderer.noteEl(w.id);
      if (el) el.classList.toggle('playing', tSec >= w.t0 && tSec < w.t1);
    }
    if (x < scroll.scrollLeft + 24 || x > scroll.scrollLeft + scroll.clientWidth - 40) {
      scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.4);
    }
  }
  function hidePlayhead() {
    cursor.style.opacity = '0';
    for (const w of playIndex) {
      const el = renderer.noteEl(w.id);
      if (el) el.classList.remove('playing');
    }
  }

  // ── v1-shaped dumps for main.js, the training export and the e2e bridge ────
  function dumpNotes(state) {
    return [...state.notes]
      .sort((a, b) => a.tick - b.tick || a.string - b.string)
      .map((n) => {
        const midi = midiAt(state, n);
        const det = n.det;
        return {
          id: n.id,
          col: Math.round(n.tick / SIXTEENTH),
          string: n.string, fret: n.fret, midi,
          detMidi: det ? det.midi : midi,
          detString: det ? det.string : n.string,
          detFret: det ? det.fret : n.fret,
          edited: !!(det && (det.string !== n.string || det.fret !== n.fret)),
          tSec: det && det.tSec != null ? det.tSec : ticksToSec(n.tick, state.tempo),
          durSec: det && det.durSec != null ? det.durSec : ticksToSec(n.durTicks, state.tempo),
        };
      });
  }

  const seeded = (fn) => { suppress++; try { return fn(); } finally { suppress--; } };

  // ── .lick file actions: Save / Open / ASCII, drag-drop, autosave ───────────
  // Gated controls stay visible when the cap is off (premium-ready upsell
  // affordance) but are disabled and inert.
  const fileActions = head.querySelector('.tab-file-actions');
  fileActions.innerHTML = `
    <button type="button" class="tab-save" title="Save as a shareable .lick file">Save</button>
    <button type="button" class="tab-open" title="Open a .lick file">Open</button>
    <button type="button" class="tab-ascii" title="Copy as ASCII tab">ASCII</button>`;
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.lick';
  fileInput.hidden = true;
  fileActions.appendChild(fileInput);

  const lockIfGated = (btn, cap) => {
    if (can(cap)) return;
    btn.disabled = true;
    btn.classList.add('tab-locked');
    btn.title = 'Available on the paid plan';
  };
  lockIfGated(fileActions.querySelector('.tab-save'), 'tab.file');
  lockIfGated(fileActions.querySelector('.tab-open'), 'tab.file');
  lockIfGated(fileActions.querySelector('.tab-ascii'), 'tab.ascii');

  // Flash a transient message on the header state text (decode errors,
  // "copied"), then restore whatever label was there before.
  let flashTimer = 0, flashRestore = null;
  function flashState(msg) {
    const st = head.querySelector('.tab-state');
    if (!st) return;
    if (flashRestore == null) flashRestore = st.textContent;
    st.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      const el = head.querySelector('.tab-state');
      if (el) el.textContent = flashRestore;
      flashRestore = null;
    }, 2500);
  }

  let loadFileCb = null;
  async function openLickFile(file) {
    try {
      const state = await readLickFile(file);
      model.load(state);
      if (loadFileCb) loadFileCb(state);
      flashState(`opened ${file.name || '.lick'}`);
    } catch (err) {
      flashState(err && err.message ? err.message : 'Could not open file');
    }
  }

  fileActions.querySelector('.tab-save').addEventListener('click', () => {
    if (!can('tab.file')) return;
    downloadLick(model.serialize(), 'lick');
  });
  fileActions.querySelector('.tab-open').addEventListener('click', () => {
    if (!can('tab.file')) return;
    fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) openLickFile(f);
    fileInput.value = '';
  });
  fileActions.querySelector('.tab-ascii').addEventListener('click', async () => {
    if (!can('tab.ascii')) return;
    try {
      await navigator.clipboard.writeText(toAscii(model.serialize()));
      flashState('ASCII tab copied');
    } catch {
      flashState('Clipboard blocked');
    }
  });

  // Drop a .lick anywhere on the lane.
  const onDragover = (e) => {
    if (!can('tab.file')) return;
    e.preventDefault();
    container.classList.add('tab-drop');
  };
  const onDragleave = () => container.classList.remove('tab-drop');
  const onDrop = (e) => {
    e.preventDefault();
    container.classList.remove('tab-drop');
    if (!can('tab.file')) return;
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) openLickFile(f);
  };
  container.addEventListener('dragover', onDragover);
  container.addEventListener('dragleave', onDragleave);
  container.addEventListener('drop', onDrop);

  // Working-copy autosave: debounced 800 ms after the last model mutation.
  let autosaveTimer = 0;
  const unsubAutosave = model.subscribe(() => {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => autosaveTab(model.serialize()), 800);
  });

  // Restore the working copy when the lane mounts empty (transcription and
  // loadNotes() both clear/seed afterwards, so this never fights them).
  const autosaved = loadAutosave();
  if (autosaved && Array.isArray(autosaved.notes) && autosaved.notes.length) model.load(autosaved);

  const api = {
    // Place a detected note (col = 16th column). meta carries pitch + timing
    // so edits preserve the sound and the export pairs notes with the audio.
    noteOn(string, fret, col, meta = {}) {
      return seeded(() => {
        const state = model.getState();
        const id = model.addNote({
          tick: col * SIXTEENTH, string, fret,
          durTicks: durTicksFromSec(meta.durSec, state.tempo),
          det: {
            midi: meta.midi != null ? meta.midi : midiAt(state, { string, fret }),
            string, fret,
            tSec: meta.tSec != null ? meta.tSec : null,
            durSec: meta.durSec != null ? meta.durSec : null,
          },
        });
        scroll.scrollLeft = Math.max(0, (col + 3) * COL_W - scroll.clientWidth);
        return id;
      });
    },

    setPlayhead, hidePlayhead,

    setPlaying(on) {
      const b = head.querySelector('.tab-play');
      if (b) { b.textContent = on ? '⏸' : '▶'; b.classList.toggle('on', on); }
    },
    onPlay(cb) { head.querySelector('.tab-play').addEventListener('click', cb); },

    // Programmatic edits (drag/dblclick paths + e2e bridge).
    moveNoteToString(id, string) {
      const ok = model.moveNote(id, { string });
      if (!ok) shakeNote(id);
      return ok;
    },
    setNoteFret(id, fret) { return model.setFret(id, fret); },

    getNotes() { return dumpNotes(model.getState()); },
    serialize() { return model.serialize(); },
    loadNotes(m) { seeded(() => model.load(m)); },
    setBpm(v) { model.setTempo(v); },
    clear() {
      seeded(() => {
        const s = model.getState();
        model.load({ version: 2, tempo: s.tempo, timeSig: s.timeSig, tuning: s.tuning, capo: s.capo, notes: [] });
      });
      ui.cursor = null; ui.selection = null;
      requestRender();
      scroll.scrollLeft = 0;
    },
    noteCount() { return model.getState().notes.length; },

    setLive(_on, label) {
      const st = head.querySelector('.tab-state');
      if (st && label) st.textContent = label;
    },
    onChange(cb) { changeCb = cb; },
    onLoadFile(cb) { loadFileCb = cb; },
    onExport(cb) { head.querySelector('.tab-export').addEventListener('click', cb); },
    onClear(cb) { head.querySelector('.tab-clear').addEventListener('click', () => { cb(); }); },
    onClose(cb) { head.querySelector('.tab-close').addEventListener('click', cb); },

    // v2 surface
    getModel() { return model; },
    getUi() { return ui; },
    focus() { stage.focus(); },

    destroy() {
      clearTimeout(autosaveTimer);
      clearTimeout(flashTimer);
      unsubAutosave();
      container.removeEventListener('dragover', onDragover);
      container.removeEventListener('dragleave', onDragleave);
      container.removeEventListener('drop', onDrop);
      input.destroy();
      renderer.destroy();
      container.innerHTML = '';
      container.hidden = true;
    },
  };

  onModelChange(model.getState());               // first paint (no cb registered yet)
  return api;
}
