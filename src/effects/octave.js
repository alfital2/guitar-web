// src/effects/octave.js — Octavia-style octave-up fuzz.
// Full-wave rectification (|x|) doubles the fundamental -> octave-up overtone,
// then hard clipping fuzzes it. Tracks best on single notes near the 12th fret.
import { makeRectifierCurve, makeHardClipCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'octave',
  label: 'Octave Fuzz',
  params: [
    { key: 'octave', label: 'Octave', min: 0, max: 1,  default: 0.7, step: 0.01 },
    { key: 'fuzz',   label: 'Fuzz',   min: 0, max: 10, default: 6,   step: 0.1 },
    { key: 'tone',   label: 'Tone',   min: 0, max: 10, default: 6,   step: 0.1 },
    { key: 'level',  label: 'Level',  min: 0, max: 10, default: 4,   step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  // Low-pass BEFORE rectifying so mostly the fundamental reaches the rectifier:
  // full-wave rectification of a tone at f produces 2f (the octave up), so the
  // octave only TRACKS the note if upper harmonics are tamed first. A fixed
  // band-pass here pins the output to one pitch regardless of the note played.
  const pre = ctx.createBiquadFilter(); pre.type = 'lowpass'; pre.frequency.value = 1100; pre.Q.value = 0.7;
  const rect = ctx.createWaveShaper(); rect.oversample = '4x';
  const fuzz = ctx.createWaveShaper(); fuzz.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const output = ctx.createGain();
  input.connect(pre); pre.connect(fuzz); fuzz.connect(rect); rect.connect(tone); tone.connect(output);

  // Each curve rebuilds only when ITS source param moved (apply() receives the
  // full param object on ANY knob change — see reverb.js's lastSize pattern).
  let lastOctave = null, lastFuzz = null;
  const apply = (p) => {
    if (p.octave !== lastOctave) {
      rect.curve = makeRectifierCurve(p.octave);
      lastOctave = p.octave;
    }
    if (p.fuzz !== lastFuzz) {
      fuzz.curve = makeHardClipCurve(p.fuzz);
      lastFuzz = p.fuzz;
    }
    tone.frequency.value = mapRange(p.tone, 0, 10, 900, 5500);
    output.gain.value = mapRange(p.level, 0, 10, 0, 1.0);
  };
  apply(params);
  return { input, output, apply };
}
