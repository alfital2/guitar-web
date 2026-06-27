// src/calibration/correction.js
export function computeCorrection(fingerprint, strength, opts = {}) {
  const cap = opts.cap ?? 6;
  const N = fingerprint.length;
  const raw = fingerprint.map((v) => -v);
  const smoothed = raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(N - 1, i + 1)];
    return (a + b + c) / 3;
  });
  return smoothed.map((v) => (Math.max(-cap, Math.min(cap, v)) * strength) || 0);
}
