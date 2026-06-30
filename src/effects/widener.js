// src/effects/widener.js — mono -> pseudo-stereo widener (Haas effect).
// One channel is delayed a few milliseconds against the other; the ear reads the
// timing difference as width. At width 0 the delay is 0, so it collapses to mono.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'widener',
  label: 'Widener',
  params: [
    { key: 'width', label: 'Width', min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const delay = ctx.createDelay(0.05);

  input.connect(merger, 0, 0);             // left: dry
  input.connect(delay); delay.connect(merger, 0, 1); // right: delayed
  merger.connect(output);

  const apply = (p) => {
    delay.delayTime.value = mapRange(p.width, 0, 10, 0, 0.022); // 0..22ms
  };
  apply(params);
  return { input, output, apply };
}
