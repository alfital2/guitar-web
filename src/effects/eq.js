// src/effects/eq.js
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'eq',
  label: 'EQ',
  params: [
    { key: 'bass',    label: 'Bass',    min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'mid',     label: 'Mid',     min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'midFreq', label: 'Mid Freq', min: 200, max: 2000, default: 750, step: 10, unit: 'Hz' },
    { key: 'treble',  label: 'Treble',  min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

const toDb = (v) => mapRange(v, 0, 10, -12, 12);

export function create(ctx, params) {
  const low = ctx.createBiquadFilter();  low.type = 'lowshelf';  low.frequency.value = 190; // 120 Hz sat under the cab rolloff — the knob audit measured it at 0.2 dB (dead)
  const mid = ctx.createBiquadFilter();  mid.type = 'peaking';   mid.Q.value = 1;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 3000;
  low.connect(mid); mid.connect(high);

  const apply = (p) => {
    low.gain.value = toDb(p.bass);
    mid.gain.value = toDb(p.mid);
    mid.frequency.value = p.midFreq;
    high.gain.value = toDb(p.treble);
  };
  apply(params);
  return { input: low, output: high, apply };
}
