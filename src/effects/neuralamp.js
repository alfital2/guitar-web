// src/effects/neuralamp.js — Neural Amp (NAM WaveNet core running as a plain
// single-thread WASM AudioWorklet on the app's own AudioContext).
//
// An amp-head effect. Graph:  input = trimGain → AudioWorkletNode('neural-amp-processor')
//                             → output = levelGain
// The worklet stays in dry passthrough until it has received both the wasm module
// bytes and a .nam model JSON via port.postMessage. Switching amps = a fresh
// preset load builds a fresh node with the new model (no in-place swap race),
// but apply() also supports live model changes by reposting the new .nam.

export const schema = {
  type: 'neuralamp',
  label: 'Neural Amp',
  params: [
    { key: 'model', label: 'Amp',   min: 0, max: 4,  default: 0, step: 1 },
    { key: 'trim',  label: 'Trim',  min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

// Model index → assets/neural/<name>.nam (WaveNet captures from the POC).
export const MODELS = ['jcm', '5153', 'deluxe', 'ac10', 'jc'];

// The compiled engine's wasm bytes are identical for every node and every
// context, so fetch them exactly once and share the promise across all create()
// calls. Posted (structured-cloned) to each worklet — never transferred, so the
// cached ArrayBuffer stays intact for later nodes.
let wasmBytesPromise = null;
function loadWasmBytes() {
  if (!wasmBytesPromise) {
    wasmBytesPromise = fetch(new URL('../../assets/neural/nam.wasm', import.meta.url))
      .then((r) => r.arrayBuffer());
  }
  return wasmBytesPromise;
}

function fetchModelJson(index) {
  const name = MODELS[index] ?? MODELS[0];
  return fetch(new URL(`../../assets/neural/${name}.nam`, import.meta.url)).then((r) => r.text());
}

// 0..10 → linear gain, centred so 5 = unity: 10 ** ((v - 5) * 0.1).
function gainFor(v) { return Math.pow(10, ((v ?? 5) - 5) * 0.1); }

export function create(ctx, params) {
  const trimGain = ctx.createGain();
  const levelGain = ctx.createGain();
  const node = new AudioWorkletNode(ctx, 'neural-amp-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    outputChannelCount: [1],
  });

  trimGain.connect(node);
  node.connect(levelGain);

  let currentModel = Math.round(params.model ?? 0);

  // Hand the worklet the engine once, then the initial model. Until the model
  // lands the worklet runs dry passthrough.
  loadWasmBytes().then((bytes) => node.port.postMessage({ type: 'wasm', bytes }));
  fetchModelJson(currentModel).then((json) => node.port.postMessage({ type: 'model', json }));

  const apply = (p) => {
    trimGain.gain.value = gainFor(p.trim);
    levelGain.gain.value = gainFor(p.level);
    const m = Math.round(p.model ?? 0);
    if (m !== currentModel) {
      currentModel = m;
      fetchModelJson(m).then((json) => node.port.postMessage({ type: 'model', json }));
    }
  };
  apply(params);

  return { input: trimGain, output: levelGain, apply };
}
