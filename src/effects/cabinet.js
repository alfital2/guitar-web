// src/effects/cabinet.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'cabinet',
  label: 'Cabinet',
  params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 10, default: 4, step: 0.1 },
    { key: 'body',       label: 'Body',       min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'presence',   label: 'Presence',   min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'mix',        label: 'Mix',        min: 0, max: 1,  default: 1, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 80;
  // Body: low-mid peaking voice of the cab.
  const bodyEq = ctx.createBiquadFilter(); bodyEq.type = 'peaking'; bodyEq.frequency.value = 2500; bodyEq.Q.value = 1.2;
  // Presence: power-amp high-shelf sheen (~4.5 kHz). Default 5 → 0 dB (neutral).
  const presenceEq = ctx.createBiquadFilter(); presenceEq.type = 'highshelf'; presenceEq.frequency.value = 4500;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
  const out = ctx.createGain();
  hp.connect(bodyEq); bodyEq.connect(presenceEq); presenceEq.connect(lp); lp.connect(out);

  const apply = (p) => {
    lp.frequency.value = mapRange(p.brightness, 0, 10, 3500, 6500);
    bodyEq.gain.value = mapRange(p.body, 0, 10, 0, 6);
    presenceEq.gain.value = mapRange(p.presence ?? 5, 0, 10, -9, 9); // 5 → 0 dB
    out.gain.value = p.mix;
  };
  apply(params);
  return { input: hp, output: out, apply };
}
