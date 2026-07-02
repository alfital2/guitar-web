// src/effects/springverb.js — spring reverb tank (Fender 6G15 / surf drip).
// A ConvolverNode loaded with a synthesized DISPERSIVE spring impulse: the
// spring's round-trips arrive as a train of short downward chirps ("drips")
// every 30-60ms over a decaying noise wash — see makeSpringImpulse in dsp.js.
// Tension sets the drip spacing (tighter spring = faster round-trips), Decay
// the tail length. A short pre-delay separates the dry attack from the splash.
import { makeSpringImpulse, mapRange } from '../dsp.js';

export const schema = {
  type: 'springverb',
  label: 'Spring Reverb',
  params: [
    { key: 'tension', label: 'Tension', min: 0, max: 10, default: 5,    step: 0.1 },
    { key: 'decay',   label: 'Decay',   min: 0, max: 10, default: 5,    step: 0.1 },
    { key: 'mix',     label: 'Mix',     min: 0, max: 1,  default: 0.35, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const pre = ctx.createDelay(0.1); pre.delayTime.value = 0.012; // tank transit pre-delay
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();
  input.connect(dry); dry.connect(output);
  input.connect(pre); pre.connect(conv); conv.connect(wet); wet.connect(output);

  // The impulse rebuilds only when a param that shapes it moved (apply()
  // receives the full param object on ANY knob change — reverb.js pattern).
  let lastTension = null, lastDecay = null;
  const apply = (p) => {
    if (p.tension !== lastTension || p.decay !== lastDecay) {
      const spacing = mapRange(p.tension, 0, 10, 0.06, 0.03); // drip period (s)
      const seconds = mapRange(p.decay, 0, 10, 0.6, 3.5);
      conv.buffer = makeSpringImpulse(ctx, seconds, spacing, 2.0);
      lastTension = p.tension; lastDecay = p.decay;
    }
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
