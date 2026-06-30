// src/effects/boost.js — clean pre-amp boost with a tilt control.
import { dbToGain, mapRange } from '../dsp.js';

export const schema = {
  type: 'boost',
  label: 'Boost',
  params: [
    { key: 'gain', label: 'Gain', min: 0, max: 24, default: 6, step: 0.5, unit: 'dB' },
    { key: 'tilt', label: 'Tilt', min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'tight', label: 'Tight', min: 0, max: 10, default: 2, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 250;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3000;
  const out = ctx.createGain();
  hp.connect(low); low.connect(high); high.connect(out);

  const apply = (p) => {
    out.gain.value = dbToGain(p.gain);
    // Tilt: 0 = darker (cut highs/boost lows), 10 = brighter (boost highs/cut lows).
    const t = mapRange(p.tilt, 0, 10, -6, 6);
    high.gain.value = t;
    low.gain.value = -t;
    hp.frequency.value = mapRange(p.tight, 0, 10, 20, 320); // cut flub before drive
  };
  apply(params);
  return { input: hp, output: out, apply };
}
