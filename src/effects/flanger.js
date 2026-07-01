// src/effects/flanger.js — short modulated delay + feedback = jet-plane sweep.
// Like chorus but with a much shorter base delay and a feedback path that
// sharpens the comb-filter notches.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'flanger',
  label: 'Flanger',
  params: [
    { key: 'rate',     label: 'Rate',     min: 0.05, max: 8, default: 0.4, step: 0.05, unit: 'Hz' },
    { key: 'depth',    label: 'Depth',    min: 0,    max: 10, default: 5, step: 0.1 },
    { key: 'feedback', label: 'Feedback', min: 0,    max: 0.95, default: 0.5, step: 0.01 },
    { key: 'mix',      label: 'Mix',      min: 0,    max: 1, default: 0.5, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay();
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  const osc = ctx.createOscillator();
  const lfoGain = ctx.createGain();

  delay.delayTime.value = 0.002;          // ~2ms base (flanger range)
  osc.type = 'sine';
  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(fb); fb.connect(delay);   // feedback loop
  delay.connect(wet); wet.connect(output);
  osc.connect(lfoGain); lfoGain.connect(delay.delayTime);
  osc.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    lfoGain.gain.value = mapRange(p.depth, 0, 10, 0, 0.003); // up to ~3ms sweep
    fb.gain.value = p.feedback;
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    for (const n of [input, output, dry, delay, fb, wet, osc, lfoGain]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
