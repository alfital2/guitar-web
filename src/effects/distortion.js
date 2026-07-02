// src/effects/distortion.js — hard-clipping distortion (Boss DS-1 territory).
// Distinct from drive (tanh soft clip / tube warmth) and fuzz (saturating
// asymmetric mush): a tight pre-highpass keeps the low end from farting out,
// then a steep linear gain is slammed into hard ±1 rails for that buzzy,
// focused 80s crunch, and a post lowpass tone tames the fizz.
import { makeDistortionCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'distortion',
  label: 'Distortion',
  params: [
    { key: 'dist',  label: 'Dist',  min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'tone',  label: 'Tone',  min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const tight = ctx.createBiquadFilter(); tight.type = 'highpass'; tight.frequency.value = 250; tight.Q.value = 0.7;
  const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.Q.value = 0.8;
  const output = ctx.createGain();
  input.connect(tight); tight.connect(shaper); shaper.connect(tone); tone.connect(output);

  // Rebuild the clip curve only when Dist actually moved (apply() receives the
  // full param object on ANY knob change — see reverb.js's lastSize pattern).
  let lastDist = null;
  const apply = (p) => {
    if (p.dist !== lastDist) {
      shaper.curve = makeDistortionCurve(p.dist);
      lastDist = p.dist;
    }
    tone.frequency.value = mapRange(p.tone, 0, 10, 900, 7000);
    output.gain.value = mapRange(p.level, 0, 10, 0, 1.0);
  };
  apply(params);
  return { input, output, apply };
}
