// src/normalize.js
// Loudness normalization: render the chain offline against a deterministic
// GUITAR-LIKE reference signal, measure integrated loudness (ITU-R BS.1770-4
// LUFS), and derive the gain that brings EVERY chain to one absolute target.
//
// One unified path for analytic AND neural (wasm-worklet) chains: a neural
// chain's wasm→model handshake completes over the worklet port BEFORE
// startRendering(), so it renders offline like everything else (verified by
// tests/loudness-audit.mjs — the old "neural can't render offline" assumption
// was wrong). The render is 100% silent — nothing connects to speakers.
//
// Why a guitar signal instead of the previous pink noise: amps are nonlinear.
// Equalizing pink-noise RMS demonstrably does NOT equalize perceived loudness
// on plucked-transient material (the 2026-07 audit measured a 15+ LU spread
// across presets that pink normalization considered "equal"). The reference is
// what the instrument actually produces: strums + single notes.
import { buildChain } from './engine.js';
import { registry } from './effects/index.js';
import { loadWorklets } from './effects/worklets/index.js';
import * as reverbFx from './effects/reverb.js';

// Every chain is normalized to this integrated loudness, measured on the
// reference signal below. -18 LUFS ≈ the pre-fix app's median, so overall
// perceived app volume is unchanged — just consistent.
export const TARGET_LUFS = -18;

const OfflineCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
  : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);

export function isNeuralChain(chain) {
  return Array.isArray(chain) && chain.some((e) => e && e.type === 'neuralamp');
}

// ── Deterministic guitar-like reference (Karplus-Strong plucks) ────────────
// Two E-minor strums + three single notes over 3 s. Fixed seed → identical
// samples every run. Peak −12 dBFS (typical DI hot-pick level).
export const REF_SECONDS = 3.0;
const refCache = new Map(); // sampleRate -> Float32Array

export function makeGuitarReference(sampleRate) {
  if (refCache.has(sampleRate)) return refCache.get(sampleRate);
  const n = Math.floor(sampleRate * REF_SECONDS);
  const out = new Float32Array(n);
  let seed = 424242;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  const pluck = (freq, t0, dur, vel) => {
    const N = Math.round(sampleRate / freq);
    const line = new Float32Array(N);
    for (let i = 0; i < N; i++) line[i] = rand() * vel;
    const start = Math.floor(t0 * sampleRate), end = Math.min(n, start + Math.floor(dur * sampleRate));
    let idx = 0;
    for (let i = start; i < end; i++) {
      const cur = line[idx];
      const nxt = line[(idx + 1) % N];
      line[idx] = 0.996 * 0.5 * (cur + nxt); // lowpassed feedback = string decay
      out[i] += cur;
      idx = (idx + 1) % N;
    }
  };
  const strum = (freqs, t0, vel) => freqs.forEach((f, i) => pluck(f, t0 + i * 0.012, 1.8, vel));
  const Em = [82.41, 123.47, 164.81, 196.0, 246.94]; // E2 B2 E3 G3 B3
  strum(Em, 0.05, 0.9);
  strum(Em, 1.05, 0.75);
  pluck(196.0, 1.9, 0.9, 0.85);   // G3
  pluck(246.94, 2.3, 0.9, 0.85);  // B3
  pluck(329.63, 2.6, 1.2, 0.9);   // E4
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = peak > 0 ? 0.251 / peak : 1; // −12 dBFS
  for (let i = 0; i < n; i++) out[i] *= k;
  refCache.set(sampleRate, out);
  return out;
}

// ── Integrated loudness, ITU-R BS.1770-4 ───────────────────────────────────
// Two-stage K-weighting (published 48 kHz coefficients — adequate over the
// 44.1–96 kHz range this app runs at) + 400 ms blocks, −70 LUFS absolute and
// −10 LU relative gating.
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function kWeight(x) {
  const s1 = biquad(x, 1.53512485958697, -2.69169618940638, 1.19839281085285,
    -1.69065929318241, 0.73248077421585);                                    // head-effect shelf
  return biquad(s1, 1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621);    // RLB high-pass
}
export function integratedLufs(channels, sampleRate) {
  const kw = channels.map(kWeight);
  const n = kw[0].length;
  const block = Math.floor(0.4 * sampleRate), hop = Math.floor(0.1 * sampleRate);
  const blocks = [];
  for (let s = 0; s + block <= n; s += hop) {
    let sum = 0;
    for (const ch of kw) { let e = 0; for (let i = s; i < s + block; i++) e += ch[i] * ch[i]; sum += e / block; }
    blocks.push(-0.691 + 10 * Math.log10(sum + 1e-12));
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
  const energyMean = (arr) => -0.691 + 10 * Math.log10(mean(arr.map((l) => 10 ** ((l + 0.691) / 10))) + 1e-12);
  const abs = blocks.filter((l) => l > -70);
  if (!abs.length) return -Infinity;
  const rel = energyMean(abs) - 10;
  const gated = abs.filter((l) => l > rel);
  return gated.length ? energyMean(gated) : -Infinity;
}

// ── Neural offline handshake ────────────────────────────────────────────────
// neuralamp.create() emits window CustomEvents tagged {offline, ctx}. Wait for
// events from EXACTLY this render's context — two measures (or a measure and a
// late event from a timed-out one) can otherwise cross-resolve on each other.
function awaitOfflineNeuralReady(ownCtx, timeoutMs) {
  if (typeof window === 'undefined' || !window.addEventListener) return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (v) => { cleanup(); resolve(v); };
    const t = setTimeout(() => done(false), timeoutMs);
    const ok = (e) => { if (e.detail && e.detail.ctx === ownCtx) done(true); };
    const bad = (e) => { if (e.detail && e.detail.ctx === ownCtx) done(false); };
    const cleanup = () => {
      clearTimeout(t);
      window.removeEventListener('neural-amp-ready', ok);
      window.removeEventListener('neural-amp-error', bad);
    };
    window.addEventListener('neural-amp-ready', ok);
    window.addEventListener('neural-amp-error', bad);
  });
}

// Measures are SERIALIZED: a neural measure costs a wasm compile + WaveNet
// render, and overlapping offline renders both burn CPU and invite event
// confusion. Each call queues behind the previous one.
let measureQueue = Promise.resolve();

// Returns the linear gain that brings this chain's integrated loudness (on the
// guitar reference) to `target` LUFS, clamped to ±24 dB (×16 / ×0.06).
// Returns NULL when the measure can't be trusted (worklet load failure, neural
// handshake timeout, silent render) — callers must keep their previous gain,
// never treat null as unity. Returns 1 only where audio genuinely can't run
// (no OfflineAudioContext, e.g. jsdom).
export function measureLoudnessGain(chain, opts = {}) {
  const run = () => measureOnce(chain, opts);
  const p = measureQueue.then(run, run);
  measureQueue = p.catch(() => {});
  return p;
}

async function measureOnce(chain, {
  sampleRate = 48000, target = TARGET_LUFS, min = 0.06, max = 16, reverb = null,
  neuralTimeoutMs = 20000,
} = {}) {
  if (!OfflineCtx) return 1;
  const length = Math.floor(sampleRate * REF_SECONDS);
  const offline = new OfflineCtx(2, length, sampleRate);
  try { await loadWorklets(offline); } catch { return null; }

  const buf = offline.createBuffer(1, length, sampleRate);
  buf.getChannelData(0).set(makeGuitarReference(sampleRate));
  const src = offline.createBufferSource();
  src.buffer = buf;

  // Attach the readiness listener BEFORE buildChain — neuralamp.create() starts
  // its handshake immediately. Matched to THIS context, so concurrent live
  // loads or stale renders can't resolve it.
  const neural = isNeuralChain(chain);
  const readyP = neural ? awaitOfflineNeuralReady(offline, neuralTimeoutMs) : null;

  let engine;
  try { engine = buildChain(offline, chain, registry); } catch { return null; }
  src.connect(engine.input);
  // Include the amp reverb stage (post-pedalboard) so its wet mix is reflected
  // in the measured loudness, matching the live signal path.
  let tail = engine.output;
  if (reverb && (reverb.mix || 0) > 0) {
    const rv = reverbFx.create(offline, reverb);
    engine.output.connect(rv.input);
    tail = rv.output;
  }
  tail.connect(offline.destination);
  src.start();

  if (neural && !(await readyP)) {
    // Model never came up. Let the context render to completion in the
    // background so it (and any late events, now unmatchable) can be GC'd,
    // and report "couldn't measure".
    offline.startRendering().catch(() => {});
    return null;
  }

  const rendered = await offline.startRendering();
  const lufs = integratedLufs(
    [rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate,
  );
  if (!isFinite(lufs)) return null; // silent render — measurement failed
  return Math.max(min, Math.min(max, 10 ** ((target - lufs) / 20)));
}
