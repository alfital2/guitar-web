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
    { key: 'model',    label: 'Amp',      min: 0, max: 4,  default: 0, step: 1 },
    { key: 'trim',     label: 'Trim',     min: 0, max: 10, default: 5, step: 0.1 },
    // Post-model analog tone stack (REAL biquads, not decoration): standard
    // NAM-player practice — the capture nails the amp's character, the stack
    // gives you the front-panel voicing controls the real amp had. 5 = flat.
    { key: 'bass',     label: 'Bass',     min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'mid',      label: 'Mid',      min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'treble',   label: 'Treble',   min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'presence', label: 'Presence', min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level',    label: 'Level',    min: 0, max: 10, default: 5, step: 0.1 },
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

// 0..10 knob → gain. 5 = unity (default, so preset loudness is unchanged);
// each step is ±1 dB up to 10 (+5 dB). The bottom of the range fades to TRUE
// ZERO so Level/Trim at 0 is silence — the old pure 10**((v-5)*0.1) bottomed
// out at 0.316 (−5 dB), which is why the amp still sounded at 0.
function gainFor(v) {
  v = v == null ? 5 : v;
  if (v <= 0) return 0;
  const g1 = Math.pow(10, -0.4);            // gain at v = 1 (≈0.398)
  if (v < 1) return v * g1;                 // linear fade 0 → g1, continuous at v=1
  return Math.pow(10, (v - 5) * 0.1);
}

// Broadcast warm-up lifecycle so the amp head can show a "tube warming up"
// state while a .nam model loads (masking the model-load dry gap). Guarded so
// the module still imports cleanly in non-DOM contexts (tests, worklets).
//   neural-amp-loading  — a model post is in flight (create or a live change)
//   neural-amp-ready    — the worklet confirmed the model is live ({type:'ready'})
//   neural-amp-error    — the worklet reported a wasm/model failure (passthrough)
function emitNeural(name, detail) {
  if (typeof window === 'undefined' || !window.dispatchEvent) return;
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
}

export function create(ctx, params) {
  // Offline contexts are silent measurement renders (loudness normalization,
  // audits) — tag their lifecycle events so the live warm-up UI ignores them
  // and the measurer can await exactly its own render's readiness.
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const trimGain = ctx.createGain();
  const levelGain = ctx.createGain();
  const node = new AudioWorkletNode(ctx, 'neural-amp-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: 'explicit',
    outputChannelCount: [1],
  });

  // Post-model tone stack: model → bass shelf → mid peak → treble shelf →
  // presence shelf → level. All biquads, ±dB around flat at 5 — zero cost at
  // defaults, real voicing when turned.
  const bassEq = ctx.createBiquadFilter(); bassEq.type = 'lowshelf'; bassEq.frequency.value = 190; // guitar-band low shelf (100 Hz sat below the cab rolloff — inaudible)
  const midEq = ctx.createBiquadFilter(); midEq.type = 'peaking'; midEq.frequency.value = 650; midEq.Q.value = 0.8;
  const trebleEq = ctx.createBiquadFilter(); trebleEq.type = 'highshelf'; trebleEq.frequency.value = 3000;
  const presenceEq = ctx.createBiquadFilter(); presenceEq.type = 'highshelf'; presenceEq.frequency.value = 6500;

  trimGain.connect(node);
  node.connect(bassEq);
  bassEq.connect(midEq);
  midEq.connect(trebleEq);
  trebleEq.connect(presenceEq);
  presenceEq.connect(levelGain);

  let wasmReady = false;       // true once the worklet OUT {type:'wasm-ready'}
  let wantModel = Math.round(Number.isFinite(params.model) ? params.model : 0);
  let lastPostedModel = null;  // dedup guard for apply()'s reposts

  // Fetch the selected .nam and hand it to the worklet. Shared by the
  // wasm-ready handler (first post) and apply() (live model changes).
  // lastPostedModel is only set once the fetch+post succeeds, so a failed
  // fetch doesn't permanently dedupe that index — a later apply() can retry it.
  function postModel(idx) {
    emitNeural('neural-amp-loading', { model: idx, offline, ctx });
    fetchModelJson(idx)
      .then((json) => {
        node.port.postMessage({ type: 'model', json });
        lastPostedModel = idx;
      })
      .catch((err) => {
        console.warn('[neuralamp] model fetch failed; staying passthrough:', err);
        emitNeural('neural-amp-error', { model: idx, offline, ctx, error: String((err && err.message) || err) });
      });
  }

  // Drive the wasm → wasm-ready → model handshake ourselves rather than
  // relying on the worklet's defensive pendingModel queue.
  node.port.onmessage = (e) => {
    const msg = e && e.data;
    if (!msg) return;
    if (msg.type === 'wasm-ready') {
      wasmReady = true;
      postModel(wantModel);
    } else if (msg.type === 'ready') {
      emitNeural('neural-amp-ready', { model: wantModel, offline, ctx });
    } else if (msg.type === 'model-error') {
      console.warn('[neuralamp] worklet reported a model error; staying passthrough:', msg.error);
      emitNeural('neural-amp-error', { model: wantModel, offline, ctx, error: msg.error });
    } else if (msg.type === 'wasm-error') {
      console.warn('[neuralamp] worklet reported a wasm error; staying passthrough:', msg.error);
      emitNeural('neural-amp-error', { model: wantModel, offline, ctx, error: msg.error });
    }
  };

  // Hand the worklet the engine bytes. Do NOT post the model yet — that
  // happens once 'wasm-ready' comes back (or on the next apply(), once ready).
  loadWasmBytes()
    .then((bytes) => node.port.postMessage({ type: 'wasm', bytes }))
    .catch((err) => console.warn('[neuralamp] wasm fetch failed; staying passthrough:', err));

  // 0..10 knob → ±dB around flat at 5.
  const dbFor = (v, span) => (((v ?? 5) - 5) / 5) * span;
  const apply = (p) => {
    const idx = Math.round(Number.isFinite(p.model) ? p.model : 0);
    wantModel = idx;
    trimGain.gain.value = gainFor(p.trim);
    bassEq.gain.value = dbFor(p.bass, 12);        // ±12 dB @ 100 Hz shelf
    midEq.gain.value = dbFor(p.mid, 9);           // ±9 dB @ 650 Hz peak
    trebleEq.gain.value = dbFor(p.treble, 12);    // ±12 dB @ 3 kHz shelf
    presenceEq.gain.value = dbFor(p.presence, 8); // ±8 dB @ 6.5 kHz shelf
    levelGain.gain.value = gainFor(p.level);
    if (wasmReady && idx !== lastPostedModel) postModel(idx);
    // If not wasmReady yet, do nothing else — the wasm-ready handler above
    // will post wantModel once the handshake completes.
  };
  apply(params);

  // Tell the worklet to stop processing (its process() otherwise returns true
  // forever — an abandoned node keeps running full WaveNet inference, ~13% of
  // a core per rebuild) and disconnect this effect's nodes.
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    try { node.port.postMessage({ type: 'destroy' }); } catch {}
    try { node.port.onmessage = null; } catch {}
    for (const n of [trimGain, node, bassEq, midEq, trebleEq, presenceEq, levelGain]) { try { n.disconnect(); } catch {} }
  };

  return { input: trimGain, output: levelGain, apply, destroy };
}
