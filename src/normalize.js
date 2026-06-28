// src/normalize.js
// Loudness normalization: render a preset's chain offline through a fixed
// reference signal, measure output RMS, and derive a gain that brings every
// preset to roughly equal loudness (output loudness ≈ input loudness). This
// passes real signal through the actual chain, so it accounts for the
// nonlinear drive/waveshaper stages, not just linear gain.
import { buildChain } from './engine.js';
import { registry } from './effects/index.js';

// Deterministic pink-ish noise (Paul Kellet's economy filter) so loudness
// measurements are reproducible across renders. Pink (≈ -3 dB/oct) is a far
// better loudness proxy for guitar-band material than flat white noise.
export function makeReferenceNoise(ctx, length) {
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  let seed = 22222; // fixed seed → deterministic
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (let i = 0; i < length; i++) {
    const white = rand();
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buf;
}

function rms(data, start, end) {
  let s = 0;
  for (let i = start; i < end; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

const OfflineCtx = typeof OfflineAudioContext !== 'undefined' ? OfflineAudioContext
  : (typeof webkitOfflineAudioContext !== 'undefined' ? webkitOfflineAudioContext : null);

// Returns a linear gain factor to apply after the chain so its output loudness
// matches the reference input loudness. Clamped to avoid wild extremes.
export async function measureLoudnessGain(chain, {
  sampleRate = 48000, seconds = 0.7, settle = 0.2, target = null, min = 0.1, max = 4,
} = {}) {
  if (!OfflineCtx) return 1;
  const length = Math.floor(sampleRate * seconds);
  const offline = new OfflineCtx(1, length, sampleRate);
  const noise = makeReferenceNoise(offline, length);
  const src = offline.createBufferSource();
  src.buffer = noise;

  const engine = buildChain(offline, chain, registry);
  src.connect(engine.input);
  engine.output.connect(offline.destination);
  src.start();

  const rendered = await offline.startRendering();
  const out = rendered.getChannelData(0);
  const skip = Math.floor(sampleRate * settle); // let compressor/filters settle
  const outRms = rms(out, skip, length);
  const inRms = target != null ? target : rms(noise.getChannelData(0), skip, length);

  if (outRms < 1e-6) return 1;
  return Math.max(min, Math.min(max, inRms / outRms));
}
