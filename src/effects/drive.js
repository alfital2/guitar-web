import { makeSoftClipCurve, mapRange } from '../dsp.js';

export const schema = {
  type: 'drive',
  label: 'Drive',
  params: [
    { key: 'amount',  label: 'Amount',   min: 0, max: 10, default: 2.5, step: 0.1 },
    { key: 'tone',    label: 'Tone',     min: 0, max: 10, default: 5,   step: 0.1 },
    { key: 'level',   label: 'Level',    min: 0, max: 10, default: 5,   step: 0.1 },
    { key: 'master',  label: 'Master',   min: 0, max: 10, default: 5,   step: 0.1 },
    { key: 'blend',   label: 'Blend',    min: 0, max: 1,  default: 0.65, step: 0.01 },
    { key: 'midBump', label: 'Mid Bump', min: 0, max: 10, default: 0,   step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  // wet path
  const midEq = ctx.createBiquadFilter(); midEq.type = 'peaking'; midEq.frequency.value = 750; midEq.Q.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  const wet = ctx.createGain();
  input.connect(midEq); midEq.connect(shaper); shaper.connect(tone); tone.connect(wet); wet.connect(output);

  // dry path (transparent clean blend)
  const dry = ctx.createGain();
  input.connect(dry); dry.connect(output);

  // Power-amp master volume: a final gain after the preamp drive + blend.
  // `level` trims the preamp output; `master` is the overall amp loudness.
  const master = ctx.createGain();
  output.connect(master);

  const apply = (p) => {
    shaper.curve = makeSoftClipCurve(p.amount);
    tone.frequency.value = mapRange(p.tone, 0, 10, 1000, 8000);
    midEq.gain.value = mapRange(p.midBump, 0, 10, 0, 12);
    wet.gain.value = p.blend;
    dry.gain.value = 1 - p.blend;
    output.gain.value = mapRange(p.level, 0, 10, 0, 2);
    master.gain.value = mapRange(p.master ?? 5, 0, 10, 0, 2); // default 5 → unity
  };
  apply(params);
  return { input, output: master, apply };
}
