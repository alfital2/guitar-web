// src/tab/offline-transcribe.js — offline (non-real-time) take → note events.
//
// Why offline wins: the whole take is in hand, so detection needs no
// causality. The pipeline is the standard research recipe for monophonic
// transcription:
//
//   1. STFT (1024-pt FFT, 256 hop, Hann) over the take
//   2. SPECTRAL FLUX onset function — Σ of positive magnitude change per bin.
//      Reacts to any spectral change, so it catches soft repicks and most
//      hammer-ons that a pure energy detector misses.
//   3. Adaptive peak-picking — a moving-median threshold (level-independent)
//      + local-max + minimum onset gap.
//   4. Per-onset pitch, ordered by trust: with earlier notes still RINGING,
//      cancel their (known) periods out of the signal and pitch the residual
//      — immune to the confident-subharmonic ghosts that plain pitch tracking
//      produces on mixtures. The residual comes back empty exactly when the
//      pick re-struck a cancelled pitch, so the fallback MPM vote (stable
//      sustain windows, median midi) covers repicks, guarded by a
//      harmonic-energy-jump check that rejects knocks over old rings.
//   5. Legato split — stable pitch runs inside one inter-onset region become
//      separate notes (hammer-on/pull-off with no attack).
//
// Pure DSP, no deps, unit-tested against synthesized Karplus-Strong plucks.

import { detectPitchMPM } from '../pitch/mpm.js';
import { freqToMidiFloat } from './transcribe.js';

// ── Radix-2 iterative FFT (in-place, complex) ───────────────────────────────
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  if (1 << levels !== n) throw new Error('FFT size must be a power of 2');
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < levels; b++) r = (r << 1) | ((i >>> b) & 1); rev[i] = r; }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = im[l] * cos[k] - re[l] * sin[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

const medianOf = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ── Spectral-flux onset detection ───────────────────────────────────────────
// Returns onset times in seconds. Level-independent: the peak-picking
// threshold rides a moving median of the flux itself.
export function spectralFluxOnsets(samples, sampleRate, {
  win = 1024, hop = 256, minGapSec = 0.055, lambda = 1.5, deltaFrac = 0.05, maxHz = 5000,
} = {}) {
  const n = samples.length;
  if (n < win * 2) return [];
  const frames = Math.floor((n - win) / hop);
  const fft = makeFFT(win);
  const hann = new Float32Array(win);
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  const bins = Math.min(win / 2, Math.ceil((maxHz * win) / sampleRate));
  const re = new Float32Array(win), im = new Float32Array(win);
  let prevMag = new Float32Array(bins), mag = new Float32Array(bins);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    for (let i = 0; i < win; i++) { re[i] = samples[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    let sum = 0;
    for (let k = 0; k < bins; k++) {
      mag[k] = Math.hypot(re[k], im[k]);
      const d = mag[k] - prevMag[k];
      if (d > 0) sum += d;
    }
    flux[f] = sum;
    const t = prevMag; prevMag = mag; mag = t;
  }
  // Adaptive threshold: moving median (±W frames) scaled, plus a small
  // absolute floor so dead-silent regions don't fire on numeric dust.
  let peak = 0; for (let f = 0; f < frames; f++) peak = Math.max(peak, flux[f]);
  if (!(peak > 0)) return [];
  const W = 16;
  const out = [];
  let lastT = -Infinity;
  for (let f = 1; f < frames - 1; f++) {
    const lo = Math.max(0, f - W), hi = Math.min(frames, f + W + 1);
    const med = medianOf(Array.from(flux.subarray(lo, hi)));
    const thresh = lambda * med + deltaFrac * peak;
    if (flux[f] > thresh && flux[f] >= flux[f - 1] && flux[f] >= flux[f + 1]) {
      const t = (f * hop + win / 2) / sampleRate; // center of the frame that moved
      if (t - lastT >= minGapSec) { out.push(t); lastT = t; }
    }
  }
  return out;
}

// ── RMS envelope helper ─────────────────────────────────────────────────────
function rmsAt(samples, start, len) {
  let s = 0; const end = Math.min(samples.length, start + len);
  const from = Math.max(0, start);
  for (let i = from; i < end; i++) s += samples[i] * samples[i];
  const cnt = Math.max(1, end - from);
  return Math.sqrt(s / cnt);
}

// ── Per-note pitch vote + legato split ──────────────────────────────────────
// For one inter-onset region: MPM windows every `step`, starting past the
// attack. Returns stable pitch RUNS (≥ minRun windows agreeing on one midi):
// the first run is the picked note, later runs are legato notes.
function pitchRuns(samples, sampleRate, fromSec, toSec, {
  attackSkipSec = 0.015, winSize = 2048, step = 512, minClarity = 0.8,
  minMidi = 36, maxMidi = 88, maxWindows = 24, minRun = 3,
} = {}) {
  const from = Math.floor((fromSec + attackSkipSec) * sampleRate);
  const to = Math.min(samples.length, Math.floor(toSec * sampleRate));
  const mids = []; // { midi|null, tSec }
  for (let w = 0, off = from; off + winSize <= to && w < maxWindows; w++, off += step) {
    if (rmsAt(samples, off, winSize) < 0.003) { mids.push({ midi: null, freq: 0, tSec: off / sampleRate }); continue; }
    const det = detectPitchMPM(samples.subarray(off, off + winSize), sampleRate);
    let midi = null, freq = 0;
    if (det && det.clarity >= minClarity) {
      const m = Math.round(freqToMidiFloat(det.freq));
      if (m >= minMidi && m <= maxMidi) { midi = m; freq = det.freq; }
    }
    mids.push({ midi, freq, tSec: off / sampleRate });
  }
  // Run-length scan over valid windows.
  const runs = [];
  let cur = null;
  for (const x of mids) {
    if (x.midi == null) continue;
    if (cur && cur.midi === x.midi) { cur.count++; cur.fsum += x.freq; }
    else { cur = { midi: x.midi, tSec: x.tSec, count: 1, fsum: x.freq }; runs.push(cur); }
  }
  return runs.filter((r) => r.count >= minRun).map((r) => ({ ...r, freq: r.fsum / r.count }));
}

// ── Period-cancellation residual pitch (the ring-over rescue) ──────────────
// When the previous string still RINGS under a new pick, the time-domain
// mixture drives MPM toward a common subharmonic with low clarity and the
// plain vote comes up empty. The old ring is nearly periodic though — so
// measure its period T from the window just BEFORE the onset (clean signal),
// then difference the post-onset signal by T: r[n] = x[n] − x[n−T] nulls
// every harmonic of the OLD note and leaves the NEW note (comb-shaped but
// pitched). MPM on the residual hears only what the pick added.
export function residualPitch(samples, sampleRate, onsetSec, {
  preClarity = 0.7, resClarity = 0.55, attackSkipSec = 0.012, winSize = 2048,
  minMidi = 36, maxMidi = 88, ringFreqs = null,
} = {}) {
  const on = Math.floor(onsetSec * sampleRate);
  // Which frequencies are ringing under this attack? Prefer the KNOWN pitches
  // of the notes transcribed just before (cascade-cancel up to two); fall
  // back to pitching the pre-onset window directly.
  let rings = (ringFreqs || []).slice(-3);
  if (!rings.length) {
    const preStart = on - winSize - 64;
    if (preStart < 0) return null;
    const pre = detectPitchMPM(samples.subarray(preStart, preStart + winSize), sampleRate);
    if (!pre || pre.clarity < preClarity) return null; // nothing clean to cancel
    rings = [pre.freq];
  }
  const from = on + Math.floor(attackSkipSec * sampleRate);
  const need = winSize + 2 * 256;
  const maxT = Math.ceil(sampleRate / 60) + 1;
  if (from - rings.length * maxT < 0 || from + need > samples.length) return null;
  // Cascade: each pass differences by one ring period, nulling its harmonics.
  // Source has margin on the left so every pass can look back by its delay.
  const margin = rings.length * maxT;
  let src = new Float32Array(margin + need);
  for (let i = 0; i < src.length; i++) src[i] = samples[from - margin + i];
  for (const f of rings) {
    const T = sampleRate / f, Ti = Math.floor(T), fr = T - Ti;
    const out = new Float32Array(src.length);
    for (let i = Ti + 1; i < src.length; i++) out[i] = src[i] - (src[i - Ti] * (1 - fr) + src[i - Ti - 1] * fr);
    src = out;
  }
  const r = src.subarray(margin);
  // median vote over 3 residual windows
  const votes = []; let fsum = 0;
  for (let w = 0; w < 3; w++) {
    const det = detectPitchMPM(r.subarray(w * 256, w * 256 + winSize), sampleRate);
    if (det && det.clarity >= resClarity) {
      const m = Math.round(freqToMidiFloat(det.freq));
      if (m >= minMidi && m <= maxMidi) { votes.push(m); fsum += det.freq; }
    }
  }
  if (votes.length < 2) return null;
  return { midi: medianOf(votes), freq: fsum / votes.length };
}

// ── Harmonic-gain check (repick vs knock) ───────────────────────────────────
// Across a true REPICK of pitch f, the energy at f's harmonics JUMPS; a knock
// or click over a ringing f adds broadband noise but barely moves them.
// Returns post/pre energy ratio summed over the first 5 harmonics.
const HG_WIN = 2048;
let hgFFT = null, hgHann = null;
export function harmonicGain(samples, sampleRate, onsetSec, freq) {
  hgFFT = hgFFT || makeFFT(HG_WIN);
  if (!hgHann) {
    hgHann = new Float32Array(HG_WIN);
    for (let i = 0; i < HG_WIN; i++) hgHann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (HG_WIN - 1));
  }
  const on = Math.floor(onsetSec * sampleRate);
  const spec = (start) => {
    const re = new Float32Array(HG_WIN), im = new Float32Array(HG_WIN);
    for (let i = 0; i < HG_WIN; i++) {
      const n = start + i;
      re[i] = (n >= 0 && n < samples.length ? samples[n] : 0) * hgHann[i];
    }
    hgFFT(re, im);
    let sum = 0, h1 = 0;
    for (let h = 1; h <= 5; h++) {
      const b = (freq * h * HG_WIN) / sampleRate;
      const k = Math.round(b);
      let e = 0;
      // widest point of the (windowed) harmonic peak ±2 bins
      for (let j = Math.max(1, k - 2); j <= Math.min(HG_WIN / 2 - 1, k + 2); j++) e += Math.hypot(re[j], im[j]);
      sum += e;
      if (h === 1) h1 = e;
    }
    return { sum, h1 };
  };
  const pre = spec(on - HG_WIN - 64);
  // sample the sustain past the attack — a pluck's fundamental needs a few
  // periods to bloom, and h1 is the octave-ghost discriminator
  const post = spec(on + Math.floor(sampleRate * 0.022));
  return {
    full: pre.sum > 1e-6 ? post.sum / pre.sum : Infinity,
    h1: pre.h1 > 1e-6 ? post.h1 / pre.h1 : Infinity,
  };
}

// ── Top level ───────────────────────────────────────────────────────────────
// samples: mono Float32Array (already trimmed to the clip window).
// Returns { notes: [{ tSec, midi, durSec }], onsets: number }.
export function transcribeTake(samples, sampleRate, opts = {}) {
  const onsets = spectralFluxOnsets(samples, sampleRate, opts);
  const endSec = samples.length / sampleRate;
  // Global level context: gate out pick-noise onsets with no body behind them.
  const p95 = (() => {
    const hop = Math.floor(sampleRate * 0.02); const vals = [];
    for (let i = 0; i + hop <= samples.length; i += hop) vals.push(rmsAt(samples, i, hop));
    const s = vals.sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length * 0.95)] : 0;
  })();
  const gate = Math.max(0.004, p95 * 0.05);

  const notes = [];
  const ringAt = (tSec) => notes.filter((n) => tSec - n.tSec < 1.6 && n.freq).map((n) => n.freq);
  for (let i = 0; i < onsets.length; i++) {
    const on = onsets[i];
    const next = i + 1 < onsets.length ? onsets[i + 1] : endSec;
    // body check: 30 ms of signal right after the attack
    const body = rmsAt(samples, Math.floor((on + 0.005) * sampleRate), Math.floor(sampleRate * 0.03));
    if (body < gate) continue;
    // ORDER OF TRUST. With old strings still ringing, plain MPM on the
    // mixture can be confidently WRONG (stable subharmonic). The cancellation
    // residual is immune to that by construction — the known ring pitches are
    // subtracted out — so when we know what's ringing, ask the residual
    // FIRST. It returns null exactly when the pick re-struck one of the
    // cancelled pitches (a repick cancels with its own ring) — then the plain
    // vote takes over, guarded by the harmonic-gain check.
    const rings = ringAt(on);
    if (rings.length) {
      const res = residualPitch(samples, sampleRate, on, { ringFreqs: rings });
      // Reject only an ECHO of a cancelled pitch (imperfect cancellation can
      // leave enough residue for MPM to re-find it). Any other pitch in the
      // residual is new by construction — no further evidence needed.
      const echo = res && rings.some((f) => Math.abs(res.midi - Math.round(freqToMidiFloat(f))) <= 1);
      if (res && !echo) {
        notes.push({ tSec: on, midi: res.midi, freq: res.freq, durSec: Math.max(0.05, next - on) });
        continue;
      }
    }
    const runs = pitchRuns(samples, sampleRate, on, Math.min(next, on + 1.5), opts);
    // A genuinely NEW note makes the energy at its own harmonics JUMP across
    // the onset. A knock letting an old ring through, or a mixture ghost,
    // fails this: that energy was already there before the pick.
    if (!runs.length || harmonicGain(samples, sampleRate, on, runs[0].freq).full < 1.15) continue;
    // First stable run = the picked note (timestamped at the ONSET, not the
    // run — the run starts after the attack skip). Later runs = legato.
    notes.push({ tSec: on, midi: runs[0].midi, freq: runs[0].freq, durSec: Math.max(0.05, next - on) });
    for (let r = 1; r < runs.length; r++) {
      if (runs[r].midi === runs[r - 1].midi) continue;
      notes.push({ tSec: runs[r].tSec, midi: runs[r].midi, freq: runs[r].freq, durSec: Math.max(0.05, next - runs[r].tSec) });
    }
  }
  return { notes, onsets: onsets.length };
}
