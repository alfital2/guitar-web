// src/tab/tab-model.js — the tab EDITOR's pure model. Musical time only:
// integer ticks at PPQ 12 (16th = 3 ticks), seconds always DERIVED from
// tempo, bars derived from the time signature. No DOM, no audio — the
// renderer, input controller and players all consume this through the
// instance API. Undo is whole-model snapshots (licks are tiny; snapshots are
// immune to op-inverse bugs).
//
// Provenance: a note seeded from transcription carries det{midi,string,fret,
// tSec,durSec} — the engine's original opinion plus its audio-time anchor —
// so the training export can pair human-corrected notes with the recording.
// `edited` is never stored; it is DERIVED (det vs current mismatch).

export const PPQ = 12;                 // ticks per quarter note
export const SIXTEENTH = 3;            // ticks per 16th = one grid column
export const MAX_FRET = 24;
// whole, dotted-half, half, dotted-quarter, quarter, dotted-8th, 8th, 16th.
// No dotted 16th — 4.5 ticks is not an integer at PPQ 12.
export const DURATIONS = [48, 36, 24, 18, 12, 9, 6, 3];

export const TUNING_PRESETS = {
  EADGBE: { name: 'Standard',    midi: [64, 59, 55, 50, 45, 40], names: ['e', 'B', 'G', 'D', 'A', 'E'] },
  DropD:  { name: 'Drop D',      midi: [64, 59, 55, 50, 45, 38], names: ['e', 'B', 'G', 'D', 'A', 'D'] },
  Eb:     { name: 'Eb Standard', midi: [63, 58, 54, 49, 44, 39], names: ['eb', 'Bb', 'Gb', 'Db', 'Ab', 'Eb'] },
  DADGAD: { name: 'DADGAD',      midi: [62, 57, 55, 50, 45, 38], names: ['d', 'A', 'G', 'D', 'A', 'D'] },
  OpenG:  { name: 'Open G',      midi: [62, 59, 55, 50, 43, 38], names: ['d', 'B', 'G', 'D', 'G', 'D'] },
};

export function barTicks(timeSig) { return timeSig.num * ((PPQ * 4) / timeSig.den); }
export function ticksToSec(tick, tempo) { return (tick / PPQ) * (60 / tempo); }
export function secToTicks(sec, tempo) { return Math.round((sec * tempo * PPQ) / 60); }

// Pitch of a note under the tab's tuning + capo. The capo shifts every
// string; frets are written relative to the nut as players expect.
export function midiAt(state, note) {
  return TUNING_PRESETS[state.tuning].midi[note.string] + (state.capo || 0) + note.fret;
}

// Detected/legacy seconds → the nearest legal duration, floor one 16th.
export function durTicksFromSec(sec, tempo) {
  if (!Number.isFinite(sec) || sec <= 0) return SIXTEENTH;
  const ticks = (sec * tempo * PPQ) / 60;
  let best = SIXTEENTH, gap = Infinity;
  for (const d of DURATIONS) {
    const g = Math.abs(d - ticks);
    if (g < gap) { gap = g; best = d; }
  }
  return best;
}

// Legal technique values (contract-fixed; toAscii and the player key off
// exactly these): hp h/p, slide / \, bend ½/full tone, dead, palm mute.
const TECH_VALUES = { hp: ['h', 'p'], slide: ['/', '\\'], bend: [0.5, 1], dead: [true], pm: [true] };

const DEFAULT_STATE = () => ({
  version: 2, tempo: 120, timeSig: { num: 4, den: 4 }, tuning: 'EADGBE', capo: 0, notes: [],
});

// v1 lane model {bpm, tuning, notes:[{col,string,fret,midi,det*,tSec,durSec}]}
// → v2. col was a 16th column; det keeps the engine's opinion AND its
// audio-time anchor for the training export.
export function migrateV1(v1) {
  const tempo = (v1 && v1.bpm) || 120;
  const notes = ((v1 && v1.notes) || []).map((n, i) => ({
    id: n.id != null ? n.id : i + 1,
    tick: Math.max(0, (n.col || 0) * SIXTEENTH),
    durTicks: durTicksFromSec(n.durSec, tempo),
    string: n.string, fret: n.fret,
    tech: {},
    det: {
      midi: n.detMidi != null ? n.detMidi : n.midi,
      string: n.detString != null ? n.detString : n.string,
      fret: n.detFret != null ? n.detFret : n.fret,
      tSec: n.tSec != null ? n.tSec : null,
      durSec: n.durSec != null ? n.durSec : null,
    },
  }));
  return { ...DEFAULT_STATE(), tempo, tuning: (v1 && v1.tuning) || 'EADGBE', notes };
}

const isV2 = (s) => !!s && s.version === 2 && Array.isArray(s.notes);
const looksV1 = (s) => !!s && Array.isArray(s.notes) && s.version == null;

export function createTabModel(init = {}) {
  let state = { ...DEFAULT_STATE(), ...structuredClone(init) };
  if (!Array.isArray(state.notes)) state.notes = [];
  let seq = state.notes.reduce((m, n) => Math.max(m, n.id || 0), 0);
  const subs = new Set();
  const undoStack = [];
  const redoStack = [];

  // Every mutation: pushUndo() BEFORE touching state, emit() after.
  function pushUndo() {
    undoStack.push(structuredClone(state));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }
  function emit() {
    const snap = structuredClone(state);
    for (const cb of subs) cb(snap);
  }

  const cellOccupant = (tick, string, exceptId) =>
    state.notes.find((n) => n.tick === tick && n.string === string && n.id !== exceptId);

  const validNote = (tick, string, fret, durTicks) =>
    Number.isInteger(tick) && tick >= 0 &&
    Number.isInteger(string) && string >= 0 && string < 6 &&
    Number.isInteger(fret) && fret >= 0 && fret <= MAX_FRET &&
    DURATIONS.includes(durTicks);

  const api = {
    getState() { return structuredClone(state); },

    // addNote — REPLACES the occupant of (tick,string): one note per cell,
    // chords live on neighboring strings of the same tick.
    addNote({ tick, string, fret, durTicks = SIXTEENTH, tech = {}, det = null }) {
      if (!validNote(tick, string, fret, durTicks)) return null;
      pushUndo();
      const old = cellOccupant(tick, string);
      if (old) state.notes = state.notes.filter((n) => n.id !== old.id);
      const note = { id: ++seq, tick, durTicks, string, fret, tech: structuredClone(tech), det: det ? structuredClone(det) : null };
      state.notes.push(note);
      emit();
      return note.id;
    },

    deleteNotes(ids) {
      const set = new Set(Array.isArray(ids) ? ids : [ids]);
      const keep = state.notes.filter((n) => !set.has(n.id));
      const count = state.notes.length - keep.length;
      if (!count) return 0;
      pushUndo();
      state.notes = keep;
      emit();
      return count;
    },

    // moveNote — a string move PRESERVES PITCH (the fret is recomputed under
    // the current tuning; impossible pitches reject the whole move). A tick
    // move takes the tick verbatim (the input layer owns grid snapping).
    moveNote(id, { tick, string } = {}) {
      const n = state.notes.find((k) => k.id === id);
      if (!n) return false;
      const toTick = tick != null ? tick : n.tick;
      let toString = n.string, toFret = n.fret;
      if (string != null && string !== n.string) {
        if (!Number.isInteger(string) || string < 0 || string > 5) return false;
        const midi = midiAt(state, n);
        const fret = midi - TUNING_PRESETS[state.tuning].midi[string] - (state.capo || 0);
        if (fret < 0 || fret > MAX_FRET) return false;
        toString = string; toFret = fret;
      }
      if (!Number.isInteger(toTick) || toTick < 0) return false;
      if (toTick === n.tick && toString === n.string) return true;   // nothing to do
      pushUndo();
      const old = cellOccupant(toTick, toString, n.id);
      if (old) state.notes = state.notes.filter((k) => k.id !== old.id);
      n.tick = toTick; n.string = toString; n.fret = toFret;
      emit();
      return true;
    },

    setFret(id, fret) {
      const n = state.notes.find((k) => k.id === id);
      if (!n || !Number.isInteger(fret) || fret < 0 || fret > MAX_FRET) return false;
      if (n.fret === fret) return true;
      pushUndo();
      n.fret = fret;
      emit();
      return true;
    },

    // setDuration — durTicks must be a DURATIONS member (the grid has no other
    // legal values; dotted-16th in particular doesn't exist at PPQ 12).
    setDuration(ids, durTicks) {
      if (!DURATIONS.includes(durTicks)) return 0;
      const set = new Set(Array.isArray(ids) ? ids : [ids]);
      const hit = state.notes.filter((n) => set.has(n.id) && n.durTicks !== durTicks);
      if (!hit.length) return 0;
      pushUndo();
      for (const n of hit) n.durTicks = durTicks;
      emit();
      return hit.length;
    },

    // toggleTech — per-note toggle: the same value clears the flag, a
    // different one replaces it. Techniques stack (a note can be hammered
    // AND palm-muted); values outside the contract table are rejected.
    toggleTech(ids, key, value) {
      const legal = TECH_VALUES[key];
      if (!legal || !legal.includes(value)) return 0;
      const set = new Set(Array.isArray(ids) ? ids : [ids]);
      const hit = state.notes.filter((n) => set.has(n.id));
      if (!hit.length) return 0;
      pushUndo();
      for (const n of hit) {
        if (n.tech[key] === value) delete n.tech[key];
        else n.tech[key] = value;
      }
      emit();
      return hit.length;
    },

    setTempo(bpm) {
      const v = Math.max(30, Math.min(300, Math.round(bpm)));
      if (!Number.isFinite(v) || v === state.tempo) return;
      pushUndo();
      state.tempo = v;
      emit();
    },

    setTimeSig(num, den) {
      if (!Number.isInteger(num) || num < 1 || num > 12 || ![2, 4, 8, 16].includes(den)) return;
      if (state.timeSig.num === num && state.timeSig.den === den) return;
      pushUndo();
      state.timeSig = { num, den };
      emit();
    },

    // Tuning change keeps FRETS — the tab is fret notation; the sound
    // re-derives.
    setTuning(presetId) {
      if (!TUNING_PRESETS[presetId] || presetId === state.tuning) return;
      pushUndo();
      state.tuning = presetId;
      emit();
    },

    setCapo(n) {
      const v = Math.max(0, Math.min(10, Math.round(n)));
      if (!Number.isFinite(v) || v === state.capo) return;
      pushUndo();
      state.capo = v;
      emit();
    },

    // Derived view for playback/export: pitch + seconds under the CURRENT
    // tempo/tuning/capo, sorted for stable rendering and scheduling.
    notesWithTime() {
      return [...state.notes]
        .sort((a, b) => a.tick - b.tick || a.string - b.string)
        .map((n) => ({
          ...structuredClone(n),
          midi: midiAt(state, n),
          tSec: ticksToSec(n.tick, state.tempo),
          durSec: ticksToSec(n.durTicks, state.tempo),
        }));
    },

    // v2 state plus a bpm alias — legacy consumers (main.js labels, the
    // training export, the old tests) read `.bpm`.
    serialize() {
      const s = structuredClone(state);
      s.bpm = s.tempo;
      return s;
    },

    load(model) {
      if (isV2(model)) state = { ...DEFAULT_STATE(), ...structuredClone(model) };
      else if (looksV1(model)) state = migrateV1(model);
      else state = DEFAULT_STATE();
      delete state.bpm;                                   // alias never lives in state
      seq = state.notes.reduce((m, n) => Math.max(m, n.id || 0), 0);
      undoStack.length = 0;
      redoStack.length = 0;
      emit();
    },

    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },

    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(structuredClone(state));
      state = undoStack.pop();
      emit();
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(structuredClone(state));
      state = redoStack.pop();
      emit();
      return true;
    },

    // Clipboard payload is relative ticks, [startTick, endTick). det never
    // rides a copy — pasted notes are new authorship, not detections.
    copyRange(startTick, endTick) {
      const notes = state.notes
        .filter((n) => n.tick >= startTick && n.tick < endTick)
        .sort((a, b) => a.tick - b.tick || a.string - b.string)
        .map((n) => ({ relTick: n.tick - startTick, string: n.string, fret: n.fret, durTicks: n.durTicks, tech: structuredClone(n.tech) }));
      return { span: endTick - startTick, notes };
    },

    // One undo snapshot + one emit for the whole paste — bulk inserts must
    // never be N separate undo steps.
    pasteAt(tick, payload) {
      if (!payload || !Array.isArray(payload.notes) || !payload.notes.length) return [];
      if (!Number.isInteger(tick) || tick < 0) return [];
      const legal = payload.notes.filter((p) => validNote(tick + p.relTick, p.string, p.fret, p.durTicks));
      if (!legal.length) return [];
      pushUndo();
      const ids = [];
      for (const p of legal) {
        const at = tick + p.relTick;
        const old = cellOccupant(at, p.string);
        if (old) state.notes = state.notes.filter((n) => n.id !== old.id);
        const note = { id: ++seq, tick: at, durTicks: p.durTicks, string: p.string, fret: p.fret, tech: structuredClone(p.tech || {}), det: null };
        state.notes.push(note);
        ids.push(note.id);
      }
      emit();
      return ids;
    },
  };

  return api;
}
