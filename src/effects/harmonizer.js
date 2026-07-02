// src/effects/harmonizer.js — intelligent-harmony-style second voice.
// The dry signal passes through untouched while a parallel pitchshift-processor
// voice (internal mix pinned to 1.0 = fully wet) is blended in at a fixed
// interval — the classic EVH/Brian May parallel fifth/third. Requires the
// pitchshift-processor worklet module to be loaded into the context first
// (see worklets/index.js).
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'harmonizer',
  label: 'Harmonizer',
  params: [
    { key: 'interval', label: 'Interval', min: -12, max: 12, default: 7, step: 1, unit: 'st' },
    { key: 'mix',      label: 'Mix',      min: 0,   max: 1,  default: 0.5, step: 0.01 },
    { key: 'level',    label: 'Level',    min: 0,   max: 10, default: 5, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const voice = new AudioWorkletNode(ctx, 'pitchshift-processor', {
    numberOfInputs: 1, numberOfOutputs: 1,
  });
  input.connect(dry); dry.connect(output);
  input.connect(voice); voice.connect(wet); wet.connect(output);

  const apply = (p) => {
    voice.parameters.get('semitones').value = p.interval;
    voice.parameters.get('mix').value = 1;          // voice is 100% wet; blend below
    dry.gain.value = 1;                             // dry always at full (true harmonizer)
    wet.gain.value = p.mix;
    output.gain.value = mapRange(p.level, 0, 10, 0, 2); // default 5 -> unity
  };
  apply(params);

  // Make the worklet's process() return false so an abandoned node stops being
  // scheduled, then disconnect (same contract as pitchshift.js).
  const destroy = () => {
    try { voice.port.postMessage({ type: 'destroy' }); } catch {}
    for (const n of [input, output, dry, wet, voice]) { try { n.disconnect(); } catch {} }
  };
  return { input, output, apply, destroy };
}
