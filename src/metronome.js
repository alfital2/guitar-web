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
// Start the recorder slightly before the audible downbeat so its ScriptProcessor
// (≈93 ms blocks) is already capturing when the player hits beat 1 — the click
// itself still fires exactly on the grid, only capture leads it.
const REC_LEAD_MS = 90;
const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

export function createMetronome({ onBeat } = {}) {
  let bpm = 120;
  let running = false;
  let ctx = null;
  let timer = null;
  let nextTime = 0; // audio-clock time of the next click
  let beat = 0;
  // A record session, when active: count-in then (optionally) keep clicking.
  // { countBeats, recordMetro, onDownbeat, fired }. Count-in and the recording
  // metronome share THIS one continuous beat grid, so there is no timing seam
  // between the last count beat and the first recorded beat.
  let session = null;

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
      const b = beat, t = nextTime;
      const inCount = session ? b < session.countBeats : false;
      const doClick = session ? (inCount || session.recordMetro) : true;
      if (doClick) {
        click(t, b % 4 === 0);
        if (onBeat) { const d = Math.max(0, (t - ctx.currentTime) * 1000); setTimeout(() => onBeat(b), d); }
      }
      // The downbeat (first beat after the count-in) is when recording begins.
      // Fire it on the same audio grid, exactly one beat after the last count.
      if (session && b === session.countBeats && !session.fired) {
        session.fired = true;
        const cb = session.onDownbeat;
        const d = Math.max(0, (t - ctx.currentTime) * 1000 - REC_LEAD_MS);
        setTimeout(() => { if (cb) cb(); }, d);
        if (!session.recordMetro) { stop(); return; } // count-in only → no clicks while recording
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
    session = null;
    beat = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(scheduler, LOOKAHEAD_MS);
  }
  function stop() {
    running = false;
    session = null;
    if (timer) { clearInterval(timer); timer = null; }
  }
  function toggle() { running ? stop() : start(); }
  function setTempo(v) { bpm = clampTempo(v); }
  function getTempo() { return bpm; }
  function isRunning() { return running; }

  // Start a record session on one continuous beat grid: `countBeats` count-in
  // clicks, then `onDownbeat` fires on the next beat (when recording starts).
  // If recordMetro is true the clicks continue through the recording; otherwise
  // the grid stops at the downbeat (count-in only, silent recording). With no
  // AudioContext (tests) onDownbeat fires synchronously.
  function startSession({ countBeats = 4, recordMetro = false, onDownbeat } = {}) {
    if (!AC) { if (onDownbeat) onDownbeat(); return; }
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    if (timer) { clearInterval(timer); timer = null; }
    session = { countBeats, recordMetro, onDownbeat, fired: false };
    running = true;
    beat = 0;
    nextTime = ctx.currentTime + 0.12;
    timer = setInterval(scheduler, LOOKAHEAD_MS);
  }

  return { start, stop, toggle, setTempo, getTempo, isRunning, startSession };
}
