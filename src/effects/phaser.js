// src/effects/phaser.js — chain of all-pass stages swept by an LFO.
// The moving all-pass notches phase-cancel against the dry signal for that
// hollow, sweeping whoosh (Hendrix, Van Halen, Gilmour).
import { mapRange } from '../dsp.js';

const STAGES = 6;

export const schema = {
  type: 'phaser',
  label: 'Phaser',
  params: [
    { key: 'rate',     label: 'Rate',     min: 0.05, max: 8, default: 0.5, step: 0.05, unit: 'Hz' },
    { key: 'depth',    label: 'Depth',    min: 0,    max: 10, default: 6, step: 0.1 },
    { key: 'feedback', label: 'Feedback', min: 0,    max: 0.9, default: 0.4, step: 0.01 },
    { key: 'mix',      label: 'Mix',      min: 0,    max: 1, default: 0.5, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const fb = ctx.createGain();
  const osc = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const lfoOffset = ctx.createConstantSource(); // center frequency of the sweep

  osc.type = 'sine';

  const stages = [];
  let node = input;
  for (let i = 0; i < STAGES; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 800;
    node.connect(ap);
    // LFO + offset both drive every stage's frequency in parallel.
    lfoGain.connect(ap.frequency);
    lfoOffset.connect(ap.frequency);
    node = ap;
    stages.push(ap);
  }
  node.connect(wet); wet.connect(output);
  node.connect(fb); fb.connect(stages[0]);   // feedback around the all-pass bank
  input.connect(dry); dry.connect(output);
  osc.connect(lfoGain);
  osc.start();
  lfoOffset.start();

  const apply = (p) => {
    osc.frequency.value = p.rate;
    lfoOffset.offset.value = 800;            // sweep centered ~800 Hz
    lfoGain.gain.value = mapRange(p.depth, 0, 10, 0, 700);
    fb.gain.value = p.feedback;
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    try { lfoOffset.stop(); } catch {}
    for (const n of [input, output, dry, wet, fb, osc, lfoGain, lfoOffset, ...stages]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
