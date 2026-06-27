// src/effects/cabinet.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'cabinet',
  label: 'Cabinet',
  params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 10, default: 4, step: 0.1 },
    { key: 'body',       label: 'Body',       min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'mix',        label: 'Mix',        min: 0, max: 1,  default: 1, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2500; presence.Q.value = 1.2;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
  const out = ctx.createGain();
  hp.connect(presence); presence.connect(lp); lp.connect(out);

  const apply = (p) => {
    lp.frequency.value = mapRange(p.brightness, 0, 10, 3500, 6500);
    presence.gain.value = mapRange(p.body, 0, 10, 0, 6);
    out.gain.value = p.mix;
  };
  apply(params);
  return { input: hp, output: out, apply };
}
