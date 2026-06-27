// src/calibration/bands.js
export const BANDS = [80, 133, 223, 371, 619, 1033, 1724, 2874, 4794, 8000];

export function bandEdges(bands = BANDS) {
  const N = bands.length;
  const edges = new Array(N + 1);
  const firstRatio = bands[1] / bands[0];
  const lastRatio = bands[N - 1] / bands[N - 2];
  edges[0] = bands[0] / Math.sqrt(firstRatio);
  for (let i = 1; i < N; i++) edges[i] = Math.sqrt(bands[i - 1] * bands[i]);
  edges[N] = bands[N - 1] * Math.sqrt(lastRatio);
  return edges;
}

export function bandIndexFor(freqHz, edges) {
  if (freqHz < edges[0] || freqHz >= edges[edges.length - 1]) return -1;
  for (let b = 0; b < edges.length - 1; b++) {
    if (freqHz >= edges[b] && freqHz < edges[b + 1]) return b;
  }
  return -1;
}

export function bandPowersFromMagnitudes(mags, sampleRate, bands = BANDS) {
  const N = bands.length;
  const edges = bandEdges(bands);
  const binHz = sampleRate / (2 * mags.length);
  const sums = new Float64Array(N);
  const counts = new Float64Array(N);
  for (let i = 0; i < mags.length; i++) {
    const f = i * binHz;
    const b = bandIndexFor(f, edges);
    if (b >= 0) { const m = mags[i]; sums[b] += m * m; counts[b]++; }
  }
  const out = new Float64Array(N);
  for (let b = 0; b < N; b++) out[b] = counts[b] ? sums[b] / counts[b] : 0;
  return out;
}
