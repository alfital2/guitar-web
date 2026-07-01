// src/effects/vibrato.js — pure pitch wobble (chorus with no dry signal).
// An LFO modulates a short delay line, shifting pitch up and down.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'vibrato',
  label: 'Vibrato',
  params: [
    { key: 'rate',  label: 'Rate',  min: 0.1, max: 10, default: 5, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0,   max: 10, default: 4, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const delay = ctx.createDelay();
  const osc = ctx.createOscillator();
  const lfoGain = ctx.createGain();

  delay.delayTime.value = 0.012;          // base delay
  osc.type = 'sine';
  input.connect(delay); delay.connect(output);
  osc.connect(lfoGain); lfoGain.connect(delay.delayTime);
  osc.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    lfoGain.gain.value = mapRange(p.depth, 0, 10, 0, 0.006);
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    for (const n of [input, output, delay, osc, lfoGain]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
