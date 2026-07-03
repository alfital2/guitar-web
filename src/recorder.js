// src/recorder.js
// Captures the live processed output to a take (raw Float32 PCM). Prefers an
// AudioWorklet tap (capture-processor.js — audio-thread capture, no main-thread
// bounce, no Safari stutter); falls back to a ScriptProcessor where worklets
// are unavailable. Pure chunk-assembly is testable.

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

  // The worklet tap. loadWorklets() has already added capture-processor to the
  // live ctx by the time recording starts (main.js start()); if constructing
  // the node still fails for any reason we fall back to ScriptProcessor.
  function makeWorkletTap() {
    if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) return null;
    try {
      const node = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1,
        channelCountMode: 'explicit', outputChannelCount: [1],
      });
      node.port.onmessage = (e) => { if (recording && e.data) chunks.push(e.data); }; // transferred buffer — no copy
      node.__isWorklet = true;
      return node;
    } catch { return null; }
  }

  function makeScriptTap() {
    if (!ctx.createScriptProcessor) return null;
    const node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      const ch = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(ch)); // copy (the buffer is reused)
    };
    return node;
  }

  function start() {
    if (recording) return;
    ctx = getContext && getContext();
    source = getSource && getSource();
    if (!ctx || !source) { recording = true; return; } // no audio (tests): just flag
    chunks = [];
    proc = makeWorkletTap() || makeScriptTap();
    if (!proc) { recording = true; return; } // no capture path (tests): just flag
    // A zero gain keeps the tap pulled by the destination without being heard.
    zero = ctx.createGain(); zero.gain.value = 0;
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
    if (proc.__isWorklet) {
      try { proc.port.postMessage('stop'); } catch {} // processor returns false → released
      try { proc.port.onmessage = null; } catch {}
    } else {
      proc.onaudioprocess = null;
    }
    try { proc.disconnect(); } catch {}
    try { zero.disconnect(); } catch {}
    const samples = concatChunks(chunks);
    const sampleRate = ctx.sampleRate;
    proc = zero = source = null; chunks = [];
    return { sampleRate, samples, duration: samples.length / sampleRate };
  }

  function isRecording() { return recording; }
  // Snapshot of everything captured so far (for live waveform drawing).
  function samplesSoFar() { return concatChunks(chunks); }
  return { start, stop, isRecording, samplesSoFar };
}
