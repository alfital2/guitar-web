// src/effects/looper.js — loop pedal (AudioWorklet-backed).
// Mode knob is the transport: 0 stop · 1 record · 2 play · 3 overdub.
// Dry passes through; the recorded loop plays underneath at Level.
// Requires the looper-processor worklet module loaded first (worklets/index.js).
export const schema = {
  type: 'looper',
  label: 'Looper',
  params: [
    { key: 'mode',  label: 'Mode',  min: 0, max: 3, default: 0, step: 1 },
    { key: 'level', label: 'Level', min: 0, max: 1, default: 0.9, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const node = new AudioWorkletNode(ctx, 'looper-processor', {
    numberOfInputs: 1, numberOfOutputs: 1,
  });
  const apply = (p) => {
    node.parameters.get('mode').value = p.mode;
    node.parameters.get('level').value = p.level;
  };
  apply(params);
  // Make the worklet's process() return false so an abandoned node stops being
  // scheduled (it would otherwise keep processing forever), then disconnect.
  const destroy = () => {
    try { node.port.postMessage({ type: 'destroy' }); } catch {}
    try { node.disconnect(); } catch {}
  };
  return { input: node, output: node, apply, destroy };
}
