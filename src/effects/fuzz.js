// src/effects/fuzz.js — aggressive hard-clipping fuzz (Fuzz Face / Big Muff territory).
import { makeHardClipCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'fuzz',
  label: 'Fuzz',
  params: [
    { key: 'fuzz',  label: 'Fuzz',  min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'tone',  label: 'Tone',  min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level', label: 'Level', min: 0, max: 10, default: 4, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const pre = ctx.createBiquadFilter(); pre.type = 'highpass'; pre.frequency.value = 70; // tighten
  const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const output = ctx.createGain();
  input.connect(pre); pre.connect(shaper); shaper.connect(tone); tone.connect(output);

  const apply = (p) => {
    shaper.curve = makeHardClipCurve(p.fuzz);
    tone.frequency.value = mapRange(p.tone, 0, 10, 800, 6000);
    output.gain.value = mapRange(p.level, 0, 10, 0, 1.2);
  };
  apply(params);
  return { input, output, apply };
}
