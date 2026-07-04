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


// ── v2: onset-driven tracking ───────────────────────────────────────────────
// The v1 tracker only split notes on PITCH CHANGE or SILENCE — a re-picked
// same note never changes pitch, and fast transitions smear the analyser
// window so the agreement vote never settles ("plays two nearby notes, misses
// them"). v2 is attack-driven: an energy-flux onset FORCES a boundary and
// opens a median pitch vote over the post-attack ticks.

// Energy-flux onset detector with an adaptive floor + refractory period.
// Feed one rms per analysis tick; returns true on the tick an attack starts.
export function createOnsetDetector({
  hopSec = 0.008, gateRms = 0.006, riseRatio = 1.9, floorRatio = 2.2, refractorySec = 0.055,
} = {}) {
  let floor = 0.003;          // slow EMA of the quiet level
  let prev = 0;
  let lastOnset = -1;
  return {
    push(rms, tSec) {
      // floor tracks DOWNWARD fast, upward slowly (so sustains don't raise it
      // enough to mask the next attack, but silence resets quickly)
      floor = rms < floor ? floor * 0.7 + rms * 0.3 : floor * 0.995 + rms * 0.005;
      const rose = rms > Math.max(gateRms, prev * riseRatio, floor * floorRatio);
      prev = rms;
      if (rose && (lastOnset < 0 || tSec - lastOnset >= refractorySec)) {
        lastOnset = tSec;
        return true;
      }
      return false;
    },
  };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// Attack-driven note tracker. push({freq, clarity, rms, tSec, onset}) → events.
//  - onset  → close the active note, open a VOTE window; after `voteTicks`
//    valid pitch ticks (or `voteTimeoutSec`), the median midi becomes the new
//    note, timestamped at the onset. Robust to noisy attack frames.
//  - legato → no onset, but `jumpTicks` consecutive ticks agreeing on a
//    different midi retrigger (hammer-on / pull-off).
//  - silence (`offTicks` below the gate) releases the active note.
export function createNoteTracker2({
  voteTicks = 7, voteTimeoutSec = 0.12, jumpTicks = 5, offTicks = 14,
  gateRms = 0.005, minClarity = 0.8, minMidi = 36, maxMidi = 88,
} = {}) {
  let active = null;              // { midi, startSec }
  let vote = null;                // { tOnset, midis: [] }
  let jumpMidi = null, jumpCount = 0;
  let offCount = 0;

  const validMidi = (freq, clarity, rms) => {
    if (!freq || !(rms > gateRms) || !(clarity >= minClarity)) return null;
    const m = Math.round(freqToMidiFloat(freq));
    return m >= minMidi && m <= maxMidi ? m : null;
  };

  return {
    push({ freq, clarity, rms, tSec, onset }) {
      const events = [];
      const m = validMidi(freq, clarity, rms);

      if (onset) {
        // A pick attack ALWAYS starts a fresh note — even at the same pitch.
        if (active) { events.push({ type: 'off', midi: active.midi, tSec }); active = null; }
        vote = { tOnset: tSec, midis: [] };
        jumpMidi = null; jumpCount = 0; offCount = 0;
      }

      if (vote) {
        if (m != null) vote.midis.push(m);
        const done = vote.midis.length >= voteTicks || (tSec - vote.tOnset >= voteTimeoutSec && vote.midis.length >= 2);
        if (done) {
          const midi = median(vote.midis);
          active = { midi, startSec: vote.tOnset };
          events.push({ type: 'on', midi, tSec: vote.tOnset });
          vote = null;
        } else if (tSec - vote.tOnset >= voteTimeoutSec) {
          vote = null; // attack turned out to be noise — no pitch emerged
        }
        return events;
      }

      if (m == null) {
        jumpMidi = null; jumpCount = 0;
        if (active && ++offCount >= offTicks) {
          events.push({ type: 'off', midi: active.midi, tSec });
          active = null; offCount = 0;
        }
        return events;
      }
      offCount = 0;

      if (active && m !== active.midi) {
        // legato retrigger: sustained agreement on a new midi with no attack
        if (m === jumpMidi) jumpCount++; else { jumpMidi = m; jumpCount = 1; }
        if (jumpCount >= jumpTicks) {
          events.push({ type: 'off', midi: active.midi, tSec });
          active = { midi: m, startSec: tSec };
          events.push({ type: 'on', midi: m, tSec });
          jumpMidi = null; jumpCount = 0;
        }
      } else {
        jumpMidi = null; jumpCount = 0;
        if (!active && m != null) {
          // pitch without a detected onset (soft start): begin after agreement
          if (m === jumpMidi) jumpCount++; else { jumpMidi = m; jumpCount = 1; }
          if (jumpCount >= jumpTicks) {
            active = { midi: m, startSec: tSec };
            events.push({ type: 'on', midi: m, tSec });
            jumpMidi = null; jumpCount = 0;
          }
        }
      }
      return events;
    },
    end(tSec) {
      const events = [];
      if (active) { events.push({ type: 'off', midi: active.midi, tSec }); active = null; }
      vote = null; jumpMidi = null; jumpCount = 0; offCount = 0;
      return events;
    },
    activeMidi: () => (active ? active.midi : null),
  };
}
