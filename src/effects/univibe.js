// src/effects/univibe.js — Uni-Vibe (Shin-ei) style photocell phase-vibe.
// Four all-pass stages with STAGGERED centers (the original's four unequal
// capacitors) all swept by ONE shared unipolar LFO — the single pulsing lamp —
// plus the lamp's subtle amplitude throb in parallel. Blended ~50/50 with dry
// it's the swampy "chorus" mode (Machine Gun, Bridge of Sighs); mix at 1 is
// the pure "vibe" (vibrato) mode.
import { mapRange } from '../dsp.js';

// Unequal stage centers (Hz) — the stagger is what separates a Uni-Vibe's
// asymmetric wobble from a phaser's aligned notches.
const CENTERS = [350, 580, 1100, 2200];

export const schema = {
  type: 'univibe',
  label: 'Uni-Vibe',
  params: [
    { key: 'speed',     label: 'Speed',     min: 0.1, max: 8,  default: 3,   step: 0.05, unit: 'Hz' },
    { key: 'intensity', label: 'Intensity', min: 0,   max: 10, default: 6,   step: 0.1 },
    { key: 'mix',       label: 'Mix',       min: 0,   max: 1,  default: 0.5, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();

  // ONE unipolar LFO (the lamp): osc*0.5 + 0.5 summed in a unity gain -> 0..1.
  // Unipolar so the all-pass sweep only rises from each stage's base — a
  // bipolar LFO would swing biquad frequencies toward/below zero at high
  // intensity (same clamping bug class as the 2026-07-01 flanger fix).
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const oscHalf = ctx.createGain(); oscHalf.gain.value = 0.5;
  const lfoOffset = ctx.createConstantSource(); lfoOffset.offset.value = 0.5;
  const uni = ctx.createGain(); uni.gain.value = 1;
  osc.connect(oscHalf); oscHalf.connect(uni);
  lfoOffset.connect(uni);

  // All-pass ladder; each stage's frequency = base (its center's floor) plus
  // the shared unipolar LFO scaled per-stage so the sweep tracks its center.
  const stages = [];
  const sweepGains = [];
  let node = input;
  for (const center of CENTERS) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = center * 0.5; // sweep floor — always > 0
    ap.Q.value = 0.6;
    const sweep = ctx.createGain();
    uni.connect(sweep); sweep.connect(ap.frequency);
    node.connect(ap);
    node = ap;
    stages.push(ap); sweepGains.push({ sweep, center });
  }

  // The lamp also throbs the wet level a touch (photocell amplitude dip).
  const vca = ctx.createGain();
  const throb = ctx.createGain();
  uni.connect(throb); throb.connect(vca.gain);
  node.connect(vca); vca.connect(wet); wet.connect(output);
  input.connect(dry); dry.connect(output);

  osc.start();
  lfoOffset.start();

  const apply = (p) => {
    osc.frequency.value = p.speed;
    const depth = mapRange(p.intensity, 0, 10, 0, 1.2); // sweep width, x center
    for (const { sweep, center } of sweepGains) sweep.gain.value = depth * center;
    const throbDepth = mapRange(p.intensity, 0, 10, 0, 0.25); // subtle AM
    vca.gain.value = 1 - throbDepth;
    throb.gain.value = throbDepth;
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    try { lfoOffset.stop(); } catch {}
    const all = [input, output, dry, wet, osc, oscHalf, lfoOffset, uni, vca, throb,
      ...stages, ...sweepGains.map((s) => s.sweep)];
    for (const n of all) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
