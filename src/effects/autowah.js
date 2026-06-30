// src/effects/autowah.js — envelope-following bandpass (funk "quack").
// An in-graph envelope follower (rectify -> smooth) drives the bandpass cutoff,
// so harder picking opens the filter higher. No AudioWorklet required:
//   input -> |x| (WaveShaper) -> lowpass (smooth) -> sensitivity gain -> bp.frequency
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'autowah',
  label: 'Auto-Wah',
  params: [
    { key: 'sensitivity', label: 'Sens',  min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'range',       label: 'Range', min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'resonance',   label: 'Reso',  min: 1, max: 20, default: 6, step: 0.1 },
    { key: 'mix',         label: 'Mix',   min: 0, max: 1,  default: 0.9, step: 0.01 },
  ],
};

function absCurve(n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.abs(x); }
  return c;
}

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';

  // Envelope follower (control-rate path, never reaches output).
  const rect = ctx.createWaveShaper(); rect.curve = absCurve();
  const smooth = ctx.createBiquadFilter(); smooth.type = 'lowpass'; smooth.frequency.value = 14;
  const sens = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(bp); bp.connect(wet); wet.connect(output);
  input.connect(rect); rect.connect(smooth); smooth.connect(sens); sens.connect(bp.frequency);

  const apply = (p) => {
    const base = mapRange(p.range, 0, 10, 200, 700);
    bp.frequency.value = base;                       // resting cutoff
    bp.Q.value = p.resonance;
    sens.gain.value = mapRange(p.sensitivity, 0, 10, 0, 6000); // env (~0..1) -> up to +6kHz
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, apply };
}
