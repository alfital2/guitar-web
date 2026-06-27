// src/pitch/detector.js
// Monophonic autocorrelation pitch detection (after Chris Wilson's PitchDetect),
// with an RMS gate and a clarity gate so it returns -1 when there's no clear pitch.
export function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;

  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // too quiet

  // Trim near-silent ends to stabilize the correlation.
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  const b = buf.slice(r1, r2);
  const n = b.length;
  if (n < 8) return -1;

  const c = new Array(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++)
      c[i] += b[j] * b[j + i];

  if (c[0] <= 0) return -1;

  // Walk past the initial downslope, then find the highest peak.
  let d = 0;
  while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < n; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  if (maxpos <= 0) return -1;

  // Clarity gate: a real pitch has a strong peak relative to zero-lag energy.
  if (maxval / c[0] < 0.3) return -1;

  let T0 = maxpos;
  if (T0 > 0 && T0 < n - 1) {
    const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
    const a = (x1 + x3 - 2 * x2) / 2;
    const bb = (x3 - x1) / 2;
    if (a) T0 = T0 - bb / (2 * a);
  }
  return sampleRate / T0;
}
