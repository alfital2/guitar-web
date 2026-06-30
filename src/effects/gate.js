// src/effects/gate.js — noise gate. Silences the signal below a threshold so
// amp hum/buzz disappears between phrases. Pure Web Audio: an envelope follower
// drives a gate transfer curve whose 0..1 output multiplies the dry signal.
//   input -> |x| -> lowpass(smooth) -> gateCurve -> vca.gain
import { makeGateCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'gate',
  label: 'Noise Gate',
  params: [
    { key: 'threshold', label: 'Thresh',  min: 0, max: 10, default: 2, step: 0.1 },
    { key: 'release',   label: 'Release', min: 0, max: 10, default: 4, step: 0.1 },
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
  const vca = ctx.createGain();            // gain swung 0..1 by the gate

  const rect = ctx.createWaveShaper(); rect.curve = absCurve();
  const smooth = ctx.createBiquadFilter(); smooth.type = 'lowpass';
  const gateShaper = ctx.createWaveShaper();

  vca.gain.value = 0;                       // control path supplies the open amount
  input.connect(vca); vca.connect(output);
  input.connect(rect); rect.connect(smooth); smooth.connect(gateShaper); gateShaper.connect(vca.gain);

  const apply = (p) => {
    gateShaper.curve = makeGateCurve(mapRange(p.threshold, 0, 10, 0.005, 0.15));
    // Lower smoothing cutoff = slower release (gate hangs open longer).
    smooth.frequency.value = mapRange(p.release, 0, 10, 60, 6);
  };
  apply(params);
  return { input, output, apply };
}
