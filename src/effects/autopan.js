// src/effects/autopan.js — stereo auto-panner. An LFO sweeps a StereoPanner so
// the signal moves left<->right. Square shape = hard ping-pong; sine = smooth
// sweep. Surf/60s tremolo-pan and rhythmic stereo motion.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'autopan',
  label: 'Auto-Pan',
  params: [
    { key: 'rate',  label: 'Rate',  min: 0.1, max: 12, default: 2, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0,   max: 1,  default: 0.8, step: 0.01 },
    { key: 'shape', label: 'Shape', min: 0,   max: 1,  default: 0, step: 1 }, // 0 sine, 1 square
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const output = ctx.createGain();
  const osc = ctx.createOscillator();
  const depthGain = ctx.createGain();

  input.connect(panner); panner.connect(output);
  osc.connect(depthGain); depthGain.connect(panner.pan); // pan swept -depth..+depth
  osc.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    osc.type = p.shape >= 0.5 ? 'square' : 'sine';
    depthGain.gain.value = p.depth;
  };
  apply(params);
  return { input, output, apply };
}
