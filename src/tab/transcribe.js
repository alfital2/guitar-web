// src/tab/transcribe.js — live tab transcription core (pure, unit-tested).
//
// Phase-1 scope (owner-approved): STANDARD tuning EADGBE, frets 0-17, single
// notes (chords ignored — the mono pitch tracker reports the dominant note),
// beat-quantized against the metronome grid at the transport BPM.
//
// Three pure pieces:
//   createNoteTracker  — per-frame pitch stream → discrete note events
//   assignFret         — greedy nearest-position string/fret choice
//   quantizeToGrid     — seconds → 16th-note column on the click grid

// Standard tuning, DISPLAY order: index 0 = high e line (top of tab) … 5 = low E.
export const TUNING_MIDI = [64, 59, 55, 50, 45, 40]; // e B G D A E
export const MAX_FRET = 17;

export const freqToMidiFloat = (f) => 69 + 12 * Math.log2(f / 440);

// ── Note segmentation ───────────────────────────────────────────────────────
// Feed one detection per analysis frame: push(freq|null, clarity, rms, tSec).
// A note STARTS after `onFrames` consecutive frames agreeing on one midi (±50
// cents) above the gate; it ENDS on `offFrames` of silence/unclear, or
// RETRIGGERS immediately when the agreed pitch jumps to a different midi
// (hammer-ons/pull-offs have no silence between notes).
export function createNoteTracker({
  onFrames = 3, offFrames = 5, gateRms = 0.008, minClarity = 0.86, minMidi = 36, maxMidi = 88,
} = {}) {
  let candMidi = null, candCount = 0, candStart = 0;
  let active = null; // { midi, startSec }
  let offCount = 0;

  const valid = (freq, clarity, rms) => {
    if (!freq || !(rms > gateRms) || !(clarity >= minClarity)) return null;
    const m = Math.round(freqToMidiFloat(freq));
    return m >= minMidi && m <= maxMidi ? m : null;
  };

  return {
    // Returns an array of events: {type:'on', midi, tSec} | {type:'off', midi, tSec}
    push(freq, clarity, rms, tSec) {
      const events = [];
      const m = valid(freq, clarity, rms);
      if (m == null) {
        candMidi = null; candCount = 0;
        if (active && ++offCount >= offFrames) {
          events.push({ type: 'off', midi: active.midi, tSec });
          active = null; offCount = 0;
        }
        return events;
      }
      offCount = 0;
      if (active && m === active.midi) { candMidi = null; candCount = 0; return events; }
      // different pitch than the active note (or no active note): build a candidate
      if (m === candMidi) candCount++;
      else { candMidi = m; candCount = 1; candStart = tSec; }
      if (candCount >= onFrames) {
        if (active) events.push({ type: 'off', midi: active.midi, tSec: candStart });
        active = { midi: m, startSec: candStart };
        events.push({ type: 'on', midi: m, tSec: candStart });
        candMidi = null; candCount = 0;
      }
      return events;
    },
    // Flush a dangling note (mode stopped mid-ring).
    end(tSec) {
      const events = [];
      if (active) { events.push({ type: 'off', midi: active.midi, tSec }); active = null; }
      candMidi = null; candCount = 0; offCount = 0;
      return events;
    },
    activeMidi: () => (active ? active.midi : null),
  };
}

// ── String/fret assignment ──────────────────────────────────────────────────
// Greedy nearest-position: among all playable positions for the midi note,
// minimize |fret − prevFret| + 0.6·|string − prevString|, with a small bonus
// for open strings and low positions when there is no context. Good enough
// live; a whole-phrase DP cleanup can come with the save/library phase.
export function positionsFor(midi, tuning = TUNING_MIDI, maxFret = MAX_FRET) {
  const out = [];
  for (let s = 0; s < tuning.length; s++) {
    const fret = midi - tuning[s];
    if (fret >= 0 && fret <= maxFret) out.push({ string: s, fret });
  }
  return out;
}

export function assignFret(midi, prev = null, tuning = TUNING_MIDI, maxFret = MAX_FRET) {
  const cands = positionsFor(midi, tuning, maxFret);
  if (!cands.length) return null;
  let best = null, bestCost = Infinity;
  for (const c of cands) {
    let cost;
    if (prev) {
      cost = Math.abs(c.fret - prev.fret) + 0.6 * Math.abs(c.string - prev.string);
      if (c.fret === 0) cost -= 0.4;           // open strings are free wins
    } else {
      cost = c.fret + 0.3 * c.string;          // no context: favor low/open position
      if (c.fret === 0) cost -= 1;
    }
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  return best;
}

// ── Beat quantization ───────────────────────────────────────────────────────
// tSec (seconds since the grid anchor) → 16th-note column index at `bpm`.
export function quantizeToGrid(tSec, bpm, subdiv = 4) {
  const spb = 60 / (bpm || 120);
  return Math.max(0, Math.round((tSec / spb) * subdiv));
}
