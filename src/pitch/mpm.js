// src/pitch/mpm.js
// McLeod Pitch Method: normalized square-difference function (NSDF) with
// parabolic interpolation of the chosen peak. Octave-robust and sub-cent
// accurate for monophonic signals (guitar tuning).

// NSDF over lags 0..maxLag (Tartini/McLeod). Returns Float32Array of length maxLag+1.
function nsdf(buf, maxLag) {
  const n = buf.length;
  const out = new Float32Array(maxLag + 1);
  for (let lag = 0; lag <= maxLag; lag++) {
    let acf = 0, m = 0;
    for (let i = 0; i < n - lag; i++) {
      acf += buf[i] * buf[i + lag];
      m += buf[i] * buf[i] + buf[i + lag] * buf[i + lag];
    }
    out[lag] = m > 0 ? (2 * acf) / m : 0;
  }
  return out;
}

// Indices of the maximum within each region bounded by positive-going zero
// crossings of the NSDF (McLeod's "key maxima").
function keyMaxima(d) {
  const maxima = [];
  let lag = 1;
  // Skip the initial positive lobe down to the first negative zero crossing.
  while (lag < d.length - 1 && d[lag] > 0) lag++;
  while (lag < d.length - 1) {
    if (d[lag] > 0) {
      let best = lag, bestVal = d[lag];
      while (lag < d.length - 1 && d[lag] > 0) {
        if (d[lag] > bestVal) { bestVal = d[lag]; best = lag; }
        lag++;
      }
      maxima.push(best);
    } else {
      lag++;
    }
  }
  return maxima;
}

// Parabolic interpolation around index i of array d → { x, y } (fractional lag, value).
function parabolic(d, i) {
  if (i <= 0 || i >= d.length - 1) return { x: i, y: d[i] };
  const a = d[i - 1], b = d[i], c = d[i + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return { x: i, y: b };
  const delta = 0.5 * (a - c) / denom;
  return { x: i + delta, y: b - 0.25 * (a - c) * delta };
}

export function detectPitchMPM(buf, sampleRate, opts = {}) {
  const { threshold = 0.6, minFreq = 50, maxFreq = 1500 } = opts;
  const maxLag = Math.min(buf.length - 1, Math.floor(sampleRate / minFreq));
  const minLag = Math.max(1, Math.floor(sampleRate / maxFreq));
  if (maxLag <= minLag) return null;

  const d = nsdf(buf, maxLag);
  const maxima = keyMaxima(d).filter((l) => l >= minLag);
  if (!maxima.length) return null;

  // McLeod: pick the first maximum whose value >= k * the global key maximum.
  let globalMax = 0;
  for (const l of maxima) if (d[l] > globalMax) globalMax = d[l];
  if (globalMax < threshold) return null;
  const k = 0.9;
  const cutoff = k * globalMax;
  let chosen = maxima[0];
  for (const l of maxima) { if (d[l] >= cutoff) { chosen = l; break; } }

  const { x: tau, y: clarity } = parabolic(d, chosen);
  if (tau <= 0) return null;
  const freq = sampleRate / tau;
  if (freq < minFreq || freq > maxFreq) return null;
  return { freq, clarity: Math.max(0, Math.min(1, clarity)) };
}
