// src/calibration/calibration-eq.js
import { BANDS } from './bands.js';

export function createCalibrationEq(ctx, bands = BANDS) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const filters = bands.map((f) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking';
    b.frequency.value = f;
    b.Q.value = 1;
    b.gain.value = 0;
    return b;
  });
  let prev = input;
  for (const f of filters) { prev.connect(f); prev = f; }
  prev.connect(output);

  function apply(correctionDb) {
    for (let i = 0; i < filters.length; i++) filters[i].gain.value = correctionDb[i] ?? 0;
  }
  return { input, output, apply, filters };
}
