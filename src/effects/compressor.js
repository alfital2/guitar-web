import { dbToGain } from '../dsp.js';

export const schema = {
  type: 'compressor',
  label: 'Compressor',
  params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -18, step: 1, unit: 'dB' },
    { key: 'ratio',     label: 'Ratio',     min: 1,   max: 20, default: 2.5, step: 0.1 },
    { key: 'attack',    label: 'Attack',    min: 0,   max: 1,  default: 0.005, step: 0.001, unit: 's' },
    { key: 'release',   label: 'Release',   min: 0,   max: 1,  default: 0.25, step: 0.01, unit: 's' },
    { key: 'makeup',    label: 'Makeup',    min: 0,   max: 24, default: 3,  step: 0.5, unit: 'dB' },
  ],
};

export function create(ctx, params) {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  comp.connect(makeup);
  const apply = (p) => {
    comp.threshold.value = p.threshold;
    comp.ratio.value = p.ratio;
    comp.attack.value = p.attack;
    comp.release.value = p.release;
    makeup.gain.value = dbToGain(p.makeup);
  };
  apply(params);
  return { input: comp, output: makeup, apply };
}
