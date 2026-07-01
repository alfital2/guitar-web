// src/effects/neuralamp.js — Neural Amp (NAM WaveNet core running as a plain
// single-thread WASM AudioWorklet on the app's own AudioContext).
//
// An amp-head effect. Graph:  input = trimGain → AudioWorkletNode('neural-amp-processor')
//                             → output = levelGain
// The worklet stays in dry passthrough until it has received both the wasm module
// bytes and a .nam model JSON via port.postMessage. Switching amps = a fresh
// preset load builds a fresh node with the new model (no in-place swap race),
// but apply() also supports live model changes by reposting the new .nam.
//
// This module DRIVES the handshake rather than relying on the worklet's
// defensive pendingModel queue (see neural-amp-processor.js): it posts
// {type:'wasm'} and waits for the worklet's OUT {type:'wasm-ready'} before
// ever posting {type:'model'}. OUT {type:'model-error', error} is logged and
// swallowed — the worklet stays in passthrough, nothing throws here.

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
      .then((r) => r.arrayBuffer())
      .catch((err) => {
        wasmBytesPromise = null; // don't poison the shared cache — let a later create() retry
        throw err;
      });
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

  let wasmReady = false;       // true once the worklet OUT {type:'wasm-ready'}
  let wantModel = Math.round(Number.isFinite(params.model) ? params.model : 0);
  let lastPostedModel = null;  // dedup guard for apply()'s reposts

  // Fetch the selected .nam and hand it to the worklet. Shared by the
  // wasm-ready handler (first post) and apply() (live model changes).
  // lastPostedModel is set synchronously so rapid apply() calls before the
  // fetch resolves don't race into duplicate posts for the same index.
  function postModel(idx) {
    lastPostedModel = idx;
    fetchModelJson(idx)
      .then((json) => node.port.postMessage({ type: 'model', json }))
      .catch((err) => console.warn('[neuralamp] model fetch failed; staying passthrough:', err));
  }

  // Drive the wasm → wasm-ready → model handshake ourselves rather than
  // relying on the worklet's defensive pendingModel queue.
  node.port.onmessage = (e) => {
    const msg = e && e.data;
    if (!msg) return;
    if (msg.type === 'wasm-ready') {
      wasmReady = true;
      postModel(wantModel);
    } else if (msg.type === 'model-error') {
      console.warn('[neuralamp] worklet reported a model error; staying passthrough:', msg.error);
    }
  };

  // Hand the worklet the engine bytes. Do NOT post the model yet — that
  // happens once 'wasm-ready' comes back (or on the next apply(), once ready).
  loadWasmBytes()
    .then((bytes) => node.port.postMessage({ type: 'wasm', bytes }))
    .catch((err) => console.warn('[neuralamp] wasm fetch failed; staying passthrough:', err));

  const apply = (p) => {
    const idx = Math.round(Number.isFinite(p.model) ? p.model : 0);
    wantModel = idx;
    trimGain.gain.value = gainFor(p.trim);
    levelGain.gain.value = gainFor(p.level);
    if (wasmReady && idx !== lastPostedModel) postModel(idx);
    // If not wasmReady yet, do nothing else — the wasm-ready handler above
    // will post wantModel once the handshake completes.
  };
  apply(params);

  return { input: trimGain, output: levelGain, apply };
}
