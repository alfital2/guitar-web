import { describe, it, expect } from 'vitest';
import { spectralFluxOnsets, transcribeTake } from '../src/tab/offline-transcribe.js';

// Deterministic PRNG — tests must not flake on noise bursts.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Karplus-Strong pluck — noise burst into an averaging delay line. Sounds and
// MEASURES like a plucked string: sharp broadband attack, harmonic decay.
function pluckInto(buf, sr, tSec, freq, amp = 0.5, seed = 7) {
  const N = Math.round(sr / freq);
  const start = Math.floor(tSec * sr);
  const rnd = mulberry32(seed);
  const dur = Math.min(buf.length - start, Math.floor(sr * 1.2));
  const y = new Float32Array(dur);
  for (let i = 0; i < Math.min(N, dur); i++) y[i] = (rnd() * 2 - 1) * amp;
  for (let i = N + 1; i < dur; i++) y[i] = 0.996 * 0.5 * (y[i - N] + y[i - N - 1]);
  // fade the tail — a hard truncation is a real spectral event and the onset
  // detector (correctly!) hears it
  const fade = Math.min(dur, Math.floor(sr * 0.08));
  for (let i = dur - fade; i < dur; i++) y[i] *= (dur - i) / fade;
  for (let i = 0; i < dur; i++) buf[start + i] += y[i];
}

const SR = 48000;
const A2 = 110, C3 = 130.81, E2 = 82.41;
const midiOf = (f) => Math.round(69 + 12 * Math.log2(f / 440));

describe('spectralFluxOnsets', () => {
  it('finds each pluck once, near its true time', () => {
    const buf = new Float32Array(SR * 2.2);
    pluckInto(buf, SR, 0.3, A2); pluckInto(buf, SR, 0.9, C3, 0.5, 11); pluckInto(buf, SR, 1.5, E2, 0.5, 13);
    const on = spectralFluxOnsets(buf, SR);
    expect(on.length).toBe(3);
    expect(Math.abs(on[0] - 0.3)).toBeLessThan(0.03);
    expect(Math.abs(on[1] - 0.9)).toBeLessThan(0.03);
    expect(Math.abs(on[2] - 1.5)).toBeLessThan(0.03);
  });
  it('silence produces no onsets', () => {
    expect(spectralFluxOnsets(new Float32Array(SR), SR)).toEqual([]);
  });
  it('catches a SOFT repick over a ringing loud note', () => {
    const buf = new Float32Array(SR * 1.6);
    pluckInto(buf, SR, 0.2, A2, 0.6);
    pluckInto(buf, SR, 0.7, A2, 0.15, 23);  // 12 dB quieter, same pitch
    const on = spectralFluxOnsets(buf, SR);
    expect(on.length).toBe(2);
    expect(Math.abs(on[1] - 0.7)).toBeLessThan(0.03);
  });
});

describe('transcribeTake', () => {
  it('same-pitch repick → two notes with the right midi and times', () => {
    const buf = new Float32Array(SR * 1.6);
    pluckInto(buf, SR, 0.25, A2); pluckInto(buf, SR, 0.75, A2, 0.5, 31);
    const { notes } = transcribeTake(buf, SR);
    expect(notes.length).toBe(2);
    expect(notes.map((n) => n.midi)).toEqual([midiOf(A2), midiOf(A2)]);
    expect(Math.abs(notes[0].tSec - 0.25)).toBeLessThan(0.03);
    expect(Math.abs(notes[1].tSec - 0.75)).toBeLessThan(0.03);
  });
  it('fast run of different notes all land (16ths at 120 = 125 ms apart)', () => {
    const buf = new Float32Array(SR * 1.4);
    pluckInto(buf, SR, 0.3, A2); pluckInto(buf, SR, 0.425, C3, 0.5, 41); pluckInto(buf, SR, 0.55, E2, 0.5, 43);
    const { notes } = transcribeTake(buf, SR);
    expect(notes.map((n) => n.midi)).toEqual([midiOf(A2), midiOf(C3), midiOf(E2)]);
  });
  it('legato pitch change inside one attack becomes a second note', () => {
    // One enveloped tone that JUMPS pitch mid-ring — no second attack.
    const buf = new Float32Array(SR * 1.5);
    const start = Math.floor(0.3 * SR), swap = Math.floor(0.58 * SR), end = Math.floor(1.3 * SR);
    for (let i = start; i < end; i++) {
      const t = (i - start) / SR;
      const f = i < swap ? A2 : C3;
      const env = Math.min(1, (i - start) / (SR * 0.005)) * Math.exp(-t * 1.2);
      buf[i] = 0.4 * env * Math.sin(2 * Math.PI * f * (i / SR));
    }
    const { notes } = transcribeTake(buf, SR);
    const midis = notes.map((n) => n.midi);
    expect(midis).toContain(midiOf(A2));
    expect(midis).toContain(midiOf(C3));
    expect(midis.indexOf(midiOf(A2))).toBeLessThan(midis.indexOf(midiOf(C3)));
  });
  it('pick thump with no pitch behind it is dropped (no ghost notes)', () => {
    const buf = new Float32Array(SR * 1.2);
    pluckInto(buf, SR, 0.3, A2);
    // a 10 ms broadband click at 0.8s — attack with no tonal body
    const rnd = mulberry32(99); const click = Math.floor(0.8 * SR);
    for (let i = 0; i < SR * 0.01; i++) buf[click + i] += (rnd() * 2 - 1) * 0.5;
    const { notes } = transcribeTake(buf, SR);
    expect(notes.map((n) => n.midi)).toEqual([midiOf(A2)]);
  });
  it('empty / silent take → no notes', () => {
    expect(transcribeTake(new Float32Array(SR), SR).notes).toEqual([]);
  });
  it('dense pentatonic run with heavy let-ring: ≥90% hits, ≤1 wrong pitch', () => {
    // 8ths at 120 BPM, every pluck rings 1.2 s → 4-5 strings sounding at once.
    // Harder than real single-note playing; the ring-over machinery earns its
    // keep here (plain per-window MPM scores ~75% with confident ghosts).
    const scale = [110, 130.81, 146.83, 164.81, 196, 220, 261.63, 293.66];
    const buf = new Float32Array(SR * 8);
    let t = 0.5, i = 0;
    while (t < 8 - 1.3) { pluckInto(buf, SR, t, scale[i % 8], 0.4 + 0.2 * ((i % 3) / 2), 100 + i); t += 0.25; i++; }
    const { notes } = transcribeTake(buf, SR);
    let hit = 0, wrong = 0;
    const used = new Set();
    for (let k = 0; k < i; k++) {
      const tp = 0.5 + k * 0.25, exp = midiOf(scale[k % 8]);
      const cand = notes.map((n, j) => ({ n, j, d: Math.abs(n.tSec - tp) }))
        .filter((c) => c.d < 0.06 && !used.has(c.j)).sort((a, b) => a.d - b.d)[0];
      if (!cand) continue;
      used.add(cand.j);
      if (cand.n.midi === exp) hit++; else wrong++;
    }
    expect(hit / i).toBeGreaterThanOrEqual(0.9);
    expect(wrong).toBeLessThanOrEqual(1);
  });
});
