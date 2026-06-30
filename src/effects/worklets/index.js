// Loads every AudioWorklet processor module into an AudioContext (or
// OfflineAudioContext). Must be awaited once per context before any worklet
// effect node is constructed. Idempotent — safe to call repeatedly per context.
const URLS = [
  new URL('./pitchshift-processor.js', import.meta.url).href,
  new URL('./looper-processor.js', import.meta.url).href,
];

const loaded = new WeakSet();

export async function loadWorklets(ctx) {
  if (!ctx || !ctx.audioWorklet || loaded.has(ctx)) return;
  await Promise.all(URLS.map((u) => ctx.audioWorklet.addModule(u)));
  loaded.add(ctx);
}
