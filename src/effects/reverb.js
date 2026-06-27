import { makeReverbImpulse, mapRange } from '../dsp.js';

export const schema = {
  type: 'reverb',
  label: 'Reverb',
  params: [
    { key: 'size', label: 'Size', min: 0, max: 1, default: 0.5, step: 0.01 },
    { key: 'mix',  label: 'Mix',  min: 0, max: 1, default: 0.12, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const conv = ctx.createConvolver();
  const wet = ctx.createGain();

  input.connect(dry); dry.connect(output);
  input.connect(conv); conv.connect(wet); wet.connect(output);

  let lastSize = null;
  const apply = (p) => {
    if (p.size !== lastSize) {
      const seconds = mapRange(p.size, 0, 1, 0.3, 3.0);
      conv.buffer = makeReverbImpulse(ctx, seconds, 2.0);
      lastSize = p.size;
    }
    wet.gain.value = p.mix;
    dry.gain.value = 1;
  };
  apply(params);
  return { input, output, apply };
}
