// src/effects/pitchshift.js — pitch shifter / octave (AudioWorklet-backed).
// semitones -12 = octave down, +12 = octave up. Requires the pitchshift-processor
// worklet module to be loaded into the context first (see worklets/index.js).
export const schema = {
  type: 'pitchshift',
  label: 'Pitch Shift',
  params: [
    { key: 'semitones', label: 'Pitch', min: -12, max: 12, default: -12, step: 1, unit: 'st' },
    { key: 'mix',       label: 'Mix',   min: 0,   max: 1,  default: 0.6, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const node = new AudioWorkletNode(ctx, 'pitchshift-processor', {
    numberOfInputs: 1, numberOfOutputs: 1,
  });
  const apply = (p) => {
    node.parameters.get('semitones').value = p.semitones;
    node.parameters.get('mix').value = p.mix;
  };
  apply(params);
  return { input: node, output: node, apply };
}
