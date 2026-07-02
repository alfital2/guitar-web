// src/effects/whammy.js — Digitech Whammy-style pitch bend.
// A pitchshift-processor voice whose semitone target follows the Bend knob:
// bend 0..10 sweeps 0..range semitones, smoothed (setTargetAtTime glide) so
// riding the knob gives the continuous dive-bomb/soar instead of stepping.
// Bend at 0 is (near-)unity; full bend at the default range is the classic
// +1-octave Morello scream. Requires the pitchshift-processor worklet module
// to be loaded into the context first (see worklets/index.js).
export const schema = {
  type: 'whammy',
  label: 'Whammy',
  params: [
    { key: 'bend',  label: 'Bend',  min: 0, max: 10, default: 10, step: 0.1 },
    { key: 'range', label: 'Range', min: 1, max: 24, default: 12, step: 1, unit: 'st' },
    { key: 'mix',   label: 'Mix',   min: 0, max: 1,  default: 1,  step: 0.01 },
  ],
};

const GLIDE = 0.03; // seconds — pedal-treadle-like smoothing of the bend target

export function create(ctx, params) {
  const node = new AudioWorkletNode(ctx, 'pitchshift-processor', {
    numberOfInputs: 1, numberOfOutputs: 1,
  });
  let initialized = false;
  const apply = (p) => {
    const semis = (p.bend / 10) * p.range;
    const st = node.parameters.get('semitones');
    if (!initialized) { st.value = semis; initialized = true; }
    else st.setTargetAtTime(semis, ctx.currentTime ?? 0, GLIDE);
    node.parameters.get('mix').value = p.mix;
  };
  apply(params);

  // Make the worklet's process() return false so an abandoned node stops being
  // scheduled, then disconnect (same contract as pitchshift.js).
  const destroy = () => {
    try { node.port.postMessage({ type: 'destroy' }); } catch {}
    try { node.disconnect(); } catch {}
  };
  return { input: node, output: node, apply, destroy };
}
