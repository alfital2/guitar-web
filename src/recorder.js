// src/recorder.js
// Captures the live processed output to a take (raw Float32 PCM). Prefers an
// AudioWorklet tap (capture-processor.js — audio-thread capture, no main-thread
// bounce, no Safari stutter); falls back to a ScriptProcessor where worklets
// are unavailable. Pure chunk-assembly is testable.
//
// STEREO: the tap captures 2 channels. It matters for two reasons — (1) a mono
// take played through the mixer's StereoPanner at center gets the −3 dB
// mono-pan law, so playback was quieter than the monitor; a 2-channel buffer
// passes the panner at unity. (2) stereo effects (the Haas widener, panning)
// live in the right channel — a mono downmix combs them away. When the two
// channels are identical (a mono chain up-mixed), the right one is dropped so
// mono takes still cost one buffer.

export function concatChunks(chunks) {
  let total = 0;
  for (const c of chunks) if (c) total += c.length;
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) if (c) { out.set(c, off); off += c.length; }
  return out;
}

// True when the two channels carry different audio (real stereo), sampled on a
// stride so a long take isn't fully scanned. A mono chain up-mixed to L=R
// returns false → the caller drops the duplicate right channel.
export function channelsDiffer(a, b, stride = 251) {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += stride) if (Math.abs(a[i] - b[i]) > 1e-6) return true;
  return false;
}

export function createRecorder({ getSource, getContext }) {
  let recording = false;
  let proc = null, zero = null, source = null, ctx = null;
  let chunksL = [], chunksR = [];

  // The worklet tap. loadWorklets() has already added capture-processor to the
  // live ctx by the time recording starts (main.js start()); if constructing
  // the node still fails for any reason we fall back to ScriptProcessor.
  function makeWorkletTap() {
    if (typeof AudioWorkletNode === 'undefined' || !ctx.audioWorklet) return null;
    try {
      const node = new AudioWorkletNode(ctx, 'capture-processor', {
        numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2,
        channelCountMode: 'explicit', outputChannelCount: [2],
      });
      node.port.onmessage = (e) => {
        if (!recording || !e.data) return;
        const d = e.data;
        // Robust to a version skew (a stale cached worklet posting a raw
        // Float32Array instead of {l,r}) — treat that as mono so recording
        // never silently breaks on a mismatched deploy.
        if (d instanceof Float32Array) { chunksL.push(d); return; }
        if (d.l) chunksL.push(d.l);
        if (d.r) chunksR.push(d.r);                      // transferred buffers — no copy
      };
      node.__isWorklet = true;
      return node;
    } catch { return null; }
  }

  function makeScriptTap() {
    if (!ctx.createScriptProcessor) return null;
    const node = ctx.createScriptProcessor(4096, 2, 2);
    node.onaudioprocess = (e) => {
      const buf = e.inputBuffer;
      chunksL.push(new Float32Array(buf.getChannelData(0)));           // copy (reused buffer)
      chunksR.push(new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)));
    };
    return node;
  }

  function start() {
    if (recording) return;
    ctx = getContext && getContext();
    source = getSource && getSource();
    if (!ctx || !source) { recording = true; return; } // no audio (tests): just flag
    chunksL = []; chunksR = [];
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
    const samples = concatChunks(chunksL);
    let samplesR = (chunksR.length === chunksL.length && chunksR.length) ? concatChunks(chunksR) : null;
    if (samplesR && !channelsDiffer(samples, samplesR)) samplesR = null; // mono chain — drop the duplicate
    const sampleRate = ctx.sampleRate;
    proc = zero = source = null; chunksL = []; chunksR = [];
    return { sampleRate, samples, samplesR, duration: samples.length / sampleRate };
  }

  function isRecording() { return recording; }
  // Snapshot of everything captured so far (for the live waveform — left only).
  function samplesSoFar() { return concatChunks(chunksL); }
  return { start, stop, isRecording, samplesSoFar };
}
