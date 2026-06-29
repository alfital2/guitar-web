// src/metronome.js
// Click metronome using the Web Audio "two clocks" lookahead scheduler. Pure
// tempo helpers are exported for testing; the controller degrades to a no-audio
// state when AudioContext is unavailable (tests / SSR).
export function secondsPerBeat(bpm) { return 60 / bpm; }
export function clampTempo(bpm) {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(40, Math.min(240, Math.round(bpm)));
}

const LOOKAHEAD_MS = 25;     // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.1;  // seconds of audio scheduled in advance
const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

export function createMetronome({ onBeat } = {}) {
  let bpm = 120;
  let running = false;
  let ctx = null;
  let timer = null;
  let nextTime = 0; // audio-clock time of the next click
  let beat = 0;

  function click(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(time); osc.stop(time + 0.06);
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const accent = beat % 4 === 0;
      click(nextTime, accent);
      if (onBeat) {
        const delayMs = Math.max(0, (nextTime - ctx.currentTime) * 1000);
        const b = beat;
        setTimeout(() => onBeat(b), delayMs);
      }
      nextTime += secondsPerBeat(bpm);
      beat++;
    }
  }

  function start() {
    if (running) return;
    running = true;
    if (!AC) return; // no audio (tests) — just track state
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    beat = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(scheduler, LOOKAHEAD_MS);
  }
  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function toggle() { running ? stop() : start(); }
  function setTempo(v) { bpm = clampTempo(v); }
  function getTempo() { return bpm; }
  function isRunning() { return running; }

  return { start, stop, toggle, setTempo, getTempo, isRunning };
}
