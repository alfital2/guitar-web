// src/effects/tremolo.js — amplitude modulation (classic amp tremolo / surf).
// An LFO drives the gain AudioParam: gain swings base ± depth/2.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'tremolo',
  label: 'Tremolo',
  params: [
    { key: 'rate',  label: 'Rate',  min: 0.1, max: 12, default: 5, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0,   max: 1,  default: 0.6, step: 0.01 },
    { key: 'shape', label: 'Shape', min: 0,   max: 1,  default: 0, step: 1 }, // 0 sine, 1 square
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const vca = ctx.createGain();           // the modulated amplifier
  const output = ctx.createGain();
  const osc = ctx.createOscillator();
  const depthGain = ctx.createGain();
  input.connect(vca); vca.connect(output);
  osc.connect(depthGain); depthGain.connect(vca.gain);
  osc.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    osc.type = p.shape >= 0.5 ? 'square' : 'sine';
    vca.gain.value = 1 - p.depth / 2;     // base level
    depthGain.gain.value = p.depth / 2;   // ± swing
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    for (const n of [input, vca, output, osc, depthGain]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
