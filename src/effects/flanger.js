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

// Base delay floor: delayTime must NEVER be modulated to <= 0 (Web Audio silently
// clamps negative values to 0, which used to produce an asymmetric, distorted
// sweep at high Depth — see docs/code-review-2026-07-01.md finding #9). The LFO
// is driven UNIPOLAR via an offset + amplitude pair (same pattern as phaser.js's
// lfoOffset) so delayTime always stays in [BASE_DELAY, BASE_DELAY + swing].
const BASE_DELAY = 0.001; // 1ms floor

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay();
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  const osc = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const lfoOffset = ctx.createConstantSource(); // keeps delayTime's center positive

  osc.type = 'sine';
  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(fb); fb.connect(delay);   // feedback loop
  delay.connect(wet); wet.connect(output);
  osc.connect(lfoGain); lfoGain.connect(delay.delayTime);
  lfoOffset.connect(delay.delayTime);
  osc.start();
  lfoOffset.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    // Peak-to-peak sweep width up to ~6ms at Depth=10 (matches the old ~3ms
    // width at the default Depth=5). Unipolar: delayTime ranges
    // [BASE_DELAY, BASE_DELAY + swing], always positive.
    const swing = mapRange(p.depth, 0, 10, 0, 0.006);
    lfoGain.gain.value = swing / 2;
    lfoOffset.offset.value = BASE_DELAY + swing / 2;
    fb.gain.value = p.feedback;
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    try { lfoOffset.stop(); } catch {}
    for (const n of [input, output, dry, delay, fb, wet, osc, lfoGain, lfoOffset]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
