// tools/audio-qa/metrics.js
// Pure objective metrics on a rendered output buffer, plus a verdict that flags
// common DSP problems (endless echo, runaway feedback, clipping, silence, NaN).

export function peak(s) { let m = 0; for (let i = 0; i < s.length; i++) { const a = Math.abs(s[i]); if (a > m) m = a; } return m; }
export function rms(s, a = 0, b = s.length) { let x = 0; for (let i = a; i < b; i++) x += s[i] * s[i]; return Math.sqrt(x / Math.max(1, b - a)); }
export function dcOffset(s) { let x = 0; for (let i = 0; i < s.length; i++) x += s[i]; return x / Math.max(1, s.length); }
export function hasNonFinite(s) { for (let i = 0; i < s.length; i++) if (!Number.isFinite(s[i])) return true; return false; }
export function rmsEnvelope(s, win) {
  const n = Math.max(1, Math.floor(s.length / win));
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) out[k] = rms(s, k * win, (k + 1) * win);
  return out;
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

// Analyze a rendered buffer. `inputEndSec` is when the dry input stops; energy
// after that is the effect tail.
// `clipThresh` is the peak level above which we warn. Default 1.05 (true
// full-scale). When analyzing a loudness-normalized render driven by a
// high-crest plucked signal, transient peaks legitimately exceed 1.0 (even a
// bypassed clean chain hits ~1.4), so callers pass a higher value to flag only
// gross gain-staging blowups rather than normal transients.
export function analyze(samples, sampleRate, { inputEndSec = 2, winSec = 0.25, clipThresh = 1.05 } = {}) {
  const nonFinite = hasNonFinite(samples);
  const pk = peak(samples);
  const dc = dcOffset(samples);
  const win = Math.max(1, Math.round(sampleRate * winSec));
  const env = Array.from(rmsEnvelope(samples, win));
  const peakRms = env.length ? Math.max(...env) : 0;
  const endIdx = Math.min(env.length - 1, Math.floor(inputEndSec / winSec));
  const tail = env.slice(endIdx + 1);
  const lastRms = tail.length ? tail[tail.length - 1] : 0;
  const decayDb = peakRms > 0 ? 20 * Math.log10(Math.max(1e-9, lastRms) / peakRms) : -Infinity;

  // Runaway: late tail energy rising rather than decaying.
  let growing = false;
  if (tail.length >= 8) {
    const n = tail.length;
    const recent = mean(tail.slice(n - 4));
    const before = mean(tail.slice(n - 8, n - 4));
    growing = recent > before * 1.05 && recent > 0.01;
  }
  const silent = pk < 1e-4;

  const reasons = [];
  let verdict = 'ok';
  const fail = (m) => { verdict = 'fail'; reasons.push(m); };
  const warn = (m) => { if (verdict === 'ok') verdict = 'warn'; reasons.push(m); };

  if (nonFinite) fail('non-finite samples (NaN/Inf — numerical blowup)');
  if (silent) fail('silent output (no signal)');
  if (growing) fail('runaway feedback (tail energy growing)');
  if (pk > clipThresh) warn(`clipping (peak ${pk.toFixed(2)})`);
  if (!silent && !growing && decayDb > -18) warn(`long tail / endless echo (tail ${decayDb.toFixed(0)} dB ${(inputEndSec + tail.length * winSec).toFixed(1)}s in)`);
  if (Math.abs(dc) > 0.03) warn(`DC offset ${dc.toFixed(3)}`);

  return { verdict, reasons, peak: pk, dc, decayDb: Number.isFinite(decayDb) ? +decayDb.toFixed(1) : null, peakRms: +peakRms.toFixed(4), tailRms: +lastRms.toFixed(4), growing, nonFinite, silent };
}
