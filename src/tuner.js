// src/tuner.js
// Standalone, high-precision tuner. Uses the engine's analyser when live, else
// acquires its own mic. Runs a rAF loop: MPM detect → cents → median smooth.
import { detectPitchMPM } from './pitch/mpm.js';
import { freqToCents } from './pitch/cents.js';

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function createTuner({ getLiveAnalyser, onReading, onState }) {
  let on = false;
  let raf = null;
  let ownCtx = null, ownStream = null, ownAnalyser = null;
  let analyser = null;
  let buf = null;
  const hist = []; // recent detected frequencies for smoothing

  async function acquire() {
    const live = getLiveAnalyser && getLiveAnalyser();
    if (live) { analyser = live; return; }
    if (!AC) throw new Error('no-audio');
    ownStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    ownCtx = new AC();
    if (ownCtx.state === 'suspended') await ownCtx.resume();
    ownAnalyser = ownCtx.createAnalyser();
    ownAnalyser.fftSize = 4096;
    ownCtx.createMediaStreamSource(ownStream).connect(ownAnalyser);
    analyser = ownAnalyser;
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;
    if (!buf || buf.length !== analyser.fftSize) buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    const det = detectPitchMPM(buf, analyser.context.sampleRate);
    if (!det) { hist.length = 0; onReading(null); return; }
    hist.push(det.freq);
    if (hist.length > 5) hist.shift();
    const freq = median(hist);
    const c = freqToCents(freq);
    onReading({ name: c.name, octave: c.octave, cents: c.cents, freq, clarity: det.clarity });
  }

  async function start() {
    if (on) return;
    on = true;
    try {
      await acquire();
      onState({ on: true });
      loop();
    } catch (e) {
      on = false;
      onState({ on: false, error: e && e.name === 'NotAllowedError' ? 'Mic permission denied' : 'Mic unavailable' });
    }
  }
  function stop() {
    on = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    hist.length = 0;
    if (ownStream) { ownStream.getTracks().forEach((t) => t.stop()); ownStream = null; }
    if (ownCtx) { ownCtx.close(); ownCtx = null; }
    ownAnalyser = null; analyser = null; buf = null;
    onState({ on: false });
  }
  function isOn() { return on; }
  return { start, stop, isOn };
}
