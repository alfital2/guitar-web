// src/effects/pingpong.js — stereo ping-pong delay. Repeats bounce left/right.
// Mono in; two cross-coupled delay lines feed opposite channels of a merger.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'pingpong',
  label: 'Ping-Pong',
  params: [
    { key: 'time',     label: 'Time',     min: 60, max: 800, default: 300, step: 5, unit: 'ms' },
    { key: 'feedback', label: 'Feedback', min: 0,  max: 0.9, default: 0.4, step: 0.01 },
    { key: 'tone',     label: 'Tone',     min: 0,  max: 10,  default: 5, step: 0.1 },
    { key: 'mix',      label: 'Mix',      min: 0,  max: 1,   default: 0.25, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const merger = ctx.createChannelMerger(2);
  const delayL = ctx.createDelay(2.0);
  const delayR = ctx.createDelay(2.0);
  const dampL = ctx.createBiquadFilter(); dampL.type = 'lowpass';
  const dampR = ctx.createBiquadFilter(); dampR.type = 'lowpass';
  const fbL = ctx.createGain();
  const fbR = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(delayL);                         // first echo hits the left side

  delayL.connect(merger, 0, 0);                  // L taps -> left channel
  delayR.connect(merger, 0, 1);                  // R taps -> right channel
  delayL.connect(dampL); dampL.connect(fbL); fbL.connect(delayR); // L -> R
  delayR.connect(dampR); dampR.connect(fbR); fbR.connect(delayL); // R -> L

  merger.connect(wet); wet.connect(output);

  const apply = (p) => {
    delayL.delayTime.value = p.time / 1000;
    delayR.delayTime.value = p.time / 1000;
    fbL.gain.value = p.feedback;
    fbR.gain.value = p.feedback;
    const hz = mapRange(p.tone, 0, 10, 800, 7000);
    dampL.frequency.value = hz; dampR.frequency.value = hz;
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
