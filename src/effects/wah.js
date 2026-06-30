// src/effects/wah.js — fixed/manual wah. A resonant bandpass parked at a chosen
// frequency (a wah pedal frozen mid-sweep, aka "cocked wah"). Sweep the Position
// knob in real time to play it like a real wah.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'wah',
  label: 'Wah',
  params: [
    { key: 'position',  label: 'Position', min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'resonance', label: 'Reso',     min: 1, max: 20, default: 8, step: 0.1 },
    { key: 'mix',       label: 'Mix',      min: 0, max: 1,  default: 1, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';

  input.connect(dry); dry.connect(output);
  input.connect(bp); bp.connect(wet); wet.connect(output);

  const apply = (p) => {
    bp.frequency.value = mapRange(p.position, 0, 10, 350, 2200); // heel -> toe
    bp.Q.value = p.resonance;
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, apply };
}
