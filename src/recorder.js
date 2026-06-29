// src/recorder.js
// Captures the live processed output to a take (raw Float32 PCM). Uses a
// ScriptProcessor tap on the engine output; pure chunk-assembly is testable.

export function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function createRecorder({ getSource, getContext }) {
  let recording = false;
  let proc = null, zero = null, source = null, ctx = null;
  let chunks = [];

  function start() {
    if (recording) return;
    ctx = getContext && getContext();
    source = getSource && getSource();
    if (!ctx || !source || !ctx.createScriptProcessor) { recording = true; return; } // no audio (tests): just flag
    chunks = [];
    proc = ctx.createScriptProcessor(4096, 1, 1);
    zero = ctx.createGain(); zero.gain.value = 0;
    proc.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(ch)); // copy (the buffer is reused)
    };
    source.connect(proc);
    proc.connect(zero);
    zero.connect(ctx.destination);
    recording = true;
  }

  function stop() {
    if (!recording) return null;
    recording = false;
    if (!proc) return null; // no-audio path
    try { source.disconnect(proc); } catch {}
    proc.onaudioprocess = null;
    try { proc.disconnect(); } catch {}
    try { zero.disconnect(); } catch {}
    const samples = concatChunks(chunks);
    const sampleRate = ctx.sampleRate;
    proc = zero = source = null; chunks = [];
    return { sampleRate, samples, duration: samples.length / sampleRate };
  }

  function isRecording() { return recording; }
  return { start, stop, isRecording };
}
