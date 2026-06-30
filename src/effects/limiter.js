// src/effects/limiter.js — brick-wall-ish output limiter. A DynamicsCompressor
// with a high ratio, fast attack and hard knee to catch peaks and protect the
// output from clipping. Useful as the last block in a chain.
export const schema = {
  type: 'limiter',
  label: 'Limiter',
  params: [
    { key: 'threshold', label: 'Ceiling', min: -24, max: 0, default: -3, step: 0.5, unit: 'dB' },
    { key: 'release',   label: 'Release', min: 0.01, max: 0.5, default: 0.1, step: 0.01, unit: 's' },
  ],
};

export function create(ctx, params) {
  const comp = ctx.createDynamicsCompressor();
  comp.ratio.value = 20;     // limiting ratio
  comp.knee.value = 0;       // hard knee
  comp.attack.value = 0.002; // catch transients fast

  const apply = (p) => {
    comp.threshold.value = p.threshold;
    comp.release.value = p.release;
  };
  apply(params);
  return { input: comp, output: comp, apply };
}
