// src/effects/chorus.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'chorus',
  label: 'Chorus',
  params: [
    { key: 'rate',  label: 'Rate',  min: 0, max: 10, default: 1.5, step: 0.1, unit: 'Hz' },
    { key: 'depth', label: 'Depth', min: 0, max: 10, default: 4,   step: 0.1 },
    { key: 'mix',   label: 'Mix',   min: 0, max: 1,  default: 0.4, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay();
  const wet = ctx.createGain();
  const osc = ctx.createOscillator();
  const lfoGain = ctx.createGain();

  delay.delayTime.value = 0.025; // base delay
  osc.type = 'sine';

  input.connect(dry); dry.connect(output);
  input.connect(delay); delay.connect(wet); wet.connect(output);
  osc.connect(lfoGain); lfoGain.connect(delay.delayTime); // modulate the delay time
  osc.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    lfoGain.gain.value = mapRange(p.depth, 0, 10, 0, 0.008);
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);

  // osc.start() never had a matching stop(): an abandoned chorus (chain
  // edit/removal) would leave the LFO running forever. Stop it and disconnect
  // every node this effect created.
  const destroy = () => {
    try { osc.stop(); } catch {}
    for (const n of [input, output, dry, delay, wet, osc, lfoGain]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
