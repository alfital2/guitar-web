// src/tab/transcribe.js — tab NOTATION helpers (pure, unit-tested).
//
// Detection lives elsewhere (neural Basic Pitch with a DSP fallback in
// offline-transcribe.js); this module owns what comes AFTER a midi note
// exists: which string/fret to write it on, and which grid column it lands
// in. Standard tuning EADGBE, frets 0-17, 16th-note grid at the transport
// BPM.

// Standard tuning, DISPLAY order: index 0 = high e line (top of tab) … 5 = low E.
export const TUNING_MIDI = [64, 59, 55, 50, 45, 40]; // e B G D A E
export const MAX_FRET = 17;

export const freqToMidiFloat = (f) => 69 + 12 * Math.log2(f / 440);

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
