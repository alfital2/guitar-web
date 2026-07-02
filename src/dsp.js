export function mapRange(x, inMin, inMax, outMin, outMax) {
  return outMin + ((x - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function dbToGain(db) { return Math.pow(10, db / 20); }

// Asymmetric soft clip. amount 0..10 -> drive k. Tanh-based, slight asymmetry
// for even harmonics (tube/Klon-like warmth).
export function makeSoftClipCurve(amount, n = 2048) {
  const k = 1 + amount * 3;            // drive intensity
  const bias = 0.1 * (amount / 10);    // asymmetry
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;   // -1..1
    const y = Math.tanh(k * x + bias) - Math.tanh(bias); // shift so f(0)=0
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

// Hard clip with a knee. amount 0..10 -> steeper, more aggressive clipping than
// the tube-ish soft clip. Used for fuzz/octave fuzz.
export function makeHardClipCurve(amount, n = 2048) {
  const k = 1 + amount * 8;             // much hotter than soft clip
  const bias = 0.18 * (amount / 10);    // strong asymmetry -> octave-ish overtones
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    let y = (k * x + bias) / (1 + Math.abs(k * x + bias)); // saturating, near-square at high k
    y -= bias / (1 + Math.abs(bias));    // recenter so f(0)=0
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

// Full-wave rectifier: y = |x|. Doubles the fundamental frequency, producing the
// octave-up overtone behind an Octavia-style fuzz. depth 0..1 blends |x| with x.
// NOTE: must satisfy f(0) = 0 like every shaping curve here — the old
// `|x|*2 - 1` remap evaluated to -depth at x=0, leaking a constant DC offset
// (~0.28 RMS hum) whenever the input was silent (probe report 2026-07-01).
export function makeRectifierCurve(depth = 1, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = depth * Math.abs(x) + (1 - depth) * x; // f(0)=0; same endpoints as before
  }
  return curve;
}

// Soft-knee gate transfer curve mapping a unipolar envelope (0..1, fed in the
// upper half of the curve domain) to a gain multiplier 0..1. Below `threshold`
// the gain falls toward 0; above it, toward 1. `knee` widens the transition.
export function makeGateCurve(threshold, knee = 0.06, n = 2048) {
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;   // -1..1; envelope arrives as 0..1 (upper half)
    const env = Math.max(0, x);
    // smoothstep from (threshold-knee) to (threshold+knee)
    const t = Math.min(1, Math.max(0, (env - (threshold - knee)) / (2 * knee)));
    curve[i] = t * t * (3 - 2 * t);
  }
  return curve;
}

export function makeReverbImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate;
  const length = Math.round(seconds * rate);
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const env = Math.pow(1 - i / length, decay);
      const white = Math.random() * 2 - 1;
      // simple low-pass to darken the tail
      last = last * 0.4 + white * 0.6;
      data[i] = last * env;
    }
  }
  return buffer;
}
