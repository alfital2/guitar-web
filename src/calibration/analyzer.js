// src/calibration/analyzer.js
import { BANDS } from './bands.js';

export function createAccumulator(numBands = BANDS.length) {
  return {
    sums: new Float64Array(numBands),
    frames: 0,
    bandSeen: new Array(numBands).fill(false),
    maxLevel: 0,
  };
}

export function accumulate(state, bandPowers, level, seenThreshold = 1e-6) {
  for (let b = 0; b < bandPowers.length; b++) {
    state.sums[b] += bandPowers[b];
    if (bandPowers[b] > seenThreshold) state.bandSeen[b] = true;
  }
  state.frames++;
  if (level > state.maxLevel) state.maxLevel = level;
  return state;
}

export function fingerprint(state) {
  const N = state.sums.length;
  const denom = Math.max(1, state.frames);
  const db = new Float64Array(N);
  for (let b = 0; b < N; b++) db[b] = 10 * Math.log10(state.sums[b] / denom + 1e-9);
  const mean = db.reduce((a, c) => a + c, 0) / N;
  return Array.from(db, (v) => v - mean);
}

export function coverage(state, minFrames, levelGate = 0.02) {
  const bandFraction = state.bandSeen.filter(Boolean).length / state.bandSeen.length;
  const durationFraction = Math.min(1, state.frames / minFrames);
  const leveled = state.maxLevel >= levelGate;
  return { bandFraction, durationFraction, leveled, coverage: leveled ? Math.min(bandFraction, durationFraction) : 0 };
}
