// src/effects/tape-echo.js — warm tape delay. Like the digital delay but the
// repeats get darker and saturate each pass, and an LFO adds wow/flutter to the
// delay time for that drifting analog character.
import { makeSoftClipCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'tape-echo',
  label: 'Tape Echo',
  params: [
    { key: 'time',     label: 'Time',     min: 40, max: 800, default: 380, step: 5, unit: 'ms' },
    { key: 'feedback', label: 'Repeats',  min: 0,  max: 0.9, default: 0.35, step: 0.01 },
    { key: 'tone',     label: 'Tone',     min: 0,  max: 10,  default: 4, step: 0.1 },
    { key: 'flutter',  label: 'Flutter',  min: 0,  max: 10,  default: 3, step: 0.1 },
    { key: 'mix',      label: 'Mix',      min: 0,  max: 1,   default: 0.2, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  const damp = ctx.createBiquadFilter(); damp.type = 'lowpass';
  const sat = ctx.createWaveShaper(); sat.oversample = '2x'; // soft saturation in the loop
  // makeSoftClipCurve(d) realises tanh(k*x) with k = 1 + d*3, so its small-signal
  // gain is k (≈5.5 here). Raw in a feedback loop that makes loop gain = feedback*k,
  // so repeats GROW (endless echo). Pre-scaling the saturator input by 1/k turns
  // the effective curve into tanh(x): unity small-signal gain (loop gain ≈ feedback,
  // so repeats decay at the knob value) plus gentle peak compression for tape warmth.
  const SAT_DRIVE = 1.5;
  const SAT_K = 1 + SAT_DRIVE * 3;
  const satIn = ctx.createGain(); satIn.gain.value = 1 / SAT_K;
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  // Wow/flutter LFO on the delay time.
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 0.7;
  const flutterGain = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(damp); damp.connect(satIn); satIn.connect(sat); sat.connect(fb); fb.connect(delay); // unity-gain saturating loop
  delay.connect(wet); wet.connect(output);
  osc.connect(flutterGain); flutterGain.connect(delay.delayTime);
  osc.start();

  sat.curve = makeSoftClipCurve(SAT_DRIVE);
  const apply = (p) => {
    delay.delayTime.value = p.time / 1000;
    fb.gain.value = p.feedback;
    damp.frequency.value = mapRange(p.tone, 0, 10, 700, 6000);
    flutterGain.gain.value = mapRange(p.flutter, 0, 10, 0, 0.0025);
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);

  const destroy = () => {
    try { osc.stop(); } catch {}
    for (const n of [input, output, dry, delay, damp, sat, satIn, fb, wet, osc, flutterGain]) { try { n.disconnect(); } catch {} }
  };

  return { input, output, apply, destroy };
}
