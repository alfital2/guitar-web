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
