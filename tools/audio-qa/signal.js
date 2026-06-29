// tools/audio-qa/signal.js
// Deterministic test signals for offline audio QA (no Web Audio — pure arrays).

// Karplus-Strong plucked string. Deterministic (fixed seed) so renders are
// reproducible across runs.
export function pluck(freq, sampleRate, durSec, decay = 0.996) {
  const N = Math.max(2, Math.round(sampleRate / freq));
  const buf = new Float32Array(N);
  let seed = 22222;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) * 2 - 1; };
  for (let i = 0; i < N; i++) buf[i] = rnd();
  const out = new Float32Array(Math.max(1, Math.round(sampleRate * durSec)));
  let idx = 0;
  for (let i = 0; i < out.length; i++) {
    const cur = buf[idx];
    const nxt = buf[(idx + 1) % N];
    out[i] = cur;
    buf[idx] = (cur + nxt) * 0.5 * decay;
    idx = (idx + 1) % N;
  }
  return out;
}

// A short generic guitar riff (a few plucked notes), then `tailSec` of silence so
// the effect tail can be analyzed. Returns { samples, sampleRate, inputEndSec }.
export function riff(sampleRate, { notes = [82.41, 110, 146.83, 196.0, 146.83, 110], noteSec = 0.28, ringSec = 0.6, tailSec = 6 } = {}) {
  const lastNoteStart = (notes.length - 1) * noteSec;
  const inputEndSec = lastNoteStart + ringSec;
  const total = Math.round(sampleRate * (inputEndSec + tailSec));
  const out = new Float32Array(total);
  notes.forEach((f, i) => {
    const p = pluck(f, sampleRate, noteSec + ringSec);
    const start = Math.round(i * noteSec * sampleRate);
    for (let j = 0; j < p.length && start + j < out.length; j++) out[start + j] += p[j] * 0.55;
  });
  return { samples: out, sampleRate, inputEndSec };
}
