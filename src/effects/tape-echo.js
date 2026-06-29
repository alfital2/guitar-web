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
  // The soft-clip curve has small-signal gain ~k (k = 1 + drive*3). Inside a
  // feedback loop that multiplies the loop gain by k, so quiet repeats would
  // GROW instead of decay (endless echo). Compensate to unity small-signal gain
  // so the saturator only softens loud repeats and feedback stays < 1.
  const SAT_DRIVE = 1.5;
  const SAT_K = 1 + SAT_DRIVE * 3;
  const satComp = ctx.createGain(); satComp.gain.value = 1 / SAT_K;
  const fb = ctx.createGain();
  const wet = ctx.createGain();
  // Wow/flutter LFO on the delay time.
  const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 0.7;
  const flutterGain = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(delay);
  delay.connect(damp); damp.connect(sat); sat.connect(satComp); satComp.connect(fb); fb.connect(delay); // unity-gain saturating loop
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
  return { input, output, apply };
}
