// src/effects/delay.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'delay',
  label: 'Delay',
  params: [
    { key: 'time',     label: 'Time',     min: 0, max: 1000, default: 320, step: 5, unit: 'ms' },
    { key: 'feedback', label: 'Feedback', min: 0, max: 0.9,  default: 0.2, step: 0.01 },
    { key: 'tone',     label: 'Tone',     min: 0, max: 10,   default: 4,   step: 0.1 },
    { key: 'mix',      label: 'Mix',      min: 0, max: 1,    default: 0.15, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay();          // default maxDelayTime 1s is enough
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass';
  const fb = ctx.createGain();
  const wet = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(damp); damp.connect(fb); fb.connect(delay);  // feedback loop
  delay.connect(wet); wet.connect(output);

  const apply = (p) => {
    delay.delayTime.value = p.time / 1000;
    fb.gain.value = p.feedback;
    damp.frequency.value = mapRange(p.tone, 0, 10, 1000, 8000);
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
