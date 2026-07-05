// src/metronome.js
// Click metronome using the Web Audio "two clocks" lookahead scheduler. Pure
// tempo helpers are exported for testing; the controller degrades to a no-audio
// state when AudioContext is unavailable (tests / SSR).
export function secondsPerBeat(bpm) { return 60 / bpm; }
export function clampTempo(bpm) {
  if (!Number.isFinite(bpm)) return 120;
  return Math.max(40, Math.min(240, Math.round(bpm)));
}

// Tap-tempo: BPM from a series of tap timestamps (ms). Uses the MEDIAN interval
// over the most recent taps so one off-beat tap doesn't wreck the estimate,
// clamped to the metronome range. Needs ≥ 2 taps; null otherwise.
export function tapToBpm(taps, { window = 6 } = {}) {
  if (!Array.isArray(taps) || taps.length < 2) return null;
  const recent = taps.slice(-window);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) {
    const g = recent[i] - recent[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  return clampTempo(60000 / med);
}

// A tap sequence resets if the player pauses longer than this between taps.
export const TAP_RESET_MS = 2000;

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
  let armedDownbeat = 0; // audio-clock time of the armed count-in downbeat (diagnostics)
  // Everything scheduled ahead of the audible "now": lookahead-scheduled click
  // oscillators and pending setTimeout ids (beat-UI callbacks + an armed
  // count-in downbeat). stop() cancels all of it — previously a scheduled
  // downbeat could still fire (and start recording) AFTER the user hit stop.
  const pendingTimeouts = new Set();
  const liveOscs = new Set();

  function after(ms, fn) {
    const id = setTimeout(() => { pendingTimeouts.delete(id); fn(); }, ms);
    pendingTimeouts.add(id);
    return id;
  }

  function click(time, accent) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1000 : 800;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(time); osc.stop(time + 0.06);
    liveOscs.add(osc);
    osc.onended = () => { liveOscs.delete(osc); try { osc.disconnect(); } catch {} try { gain.disconnect(); } catch {} };
  }

  function scheduler() {
    while (nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      const b = beat, t = nextTime;
      const inCount = session ? b < session.countBeats : false;
      const doClick = session ? (inCount || session.recordMetro) : true;
      if (doClick) {
        click(t, b % 4 === 0);
        if (onBeat) { const d = Math.max(0, (t - ctx.currentTime) * 1000); after(d, () => onBeat(b)); }
      }
      // The downbeat (first beat after the count-in) is when recording begins.
      // Fire it on the same audio grid, exactly one beat after the last count.
      if (session && b === session.countBeats && !session.fired) {
        session.fired = true;
        armedDownbeat = t; // exact audio-clock time recording is meant to start
        const cb = session.onDownbeat;
        const d = Math.max(0, (t - ctx.currentTime) * 1000 - REC_LEAD_MS);
        after(d, () => { if (cb) cb(t); }); // pass the exact downbeat audio-time to the callback
        // Count-in only → halt the grid but do NOT cancel what's pending: the
        // downbeat timeout just armed above must fire (it starts the recording)
        // and the already-scheduled count clicks should play out. A user stop()
        // during the remaining lead window still cancels everything.
        if (!session.recordMetro) { stopTicking(); return; }
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
  // Halt the beat grid (internal — leaves already-scheduled events alone).
  function stopTicking() {
    running = false;
    session = null;
    if (timer) { clearInterval(timer); timer = null; }
  }
  // Full stop: halt the grid AND cancel everything scheduled ahead — pending
  // beat/downbeat timeouts and lookahead-scheduled click oscillators.
  function stop() {
    stopTicking();
    for (const id of pendingTimeouts) clearTimeout(id);
    pendingTimeouts.clear();
    // stop() now → each osc's onended handler disconnects it and its gain.
    for (const osc of liveOscs) { try { osc.stop(); } catch {} }
    liveOscs.clear();
  }
  function toggle() { running ? stop() : start(); }
  function setTempo(v) { bpm = clampTempo(v); }
  function getTempo() { return bpm; }
  function isRunning() { return running; }

  // Arm a recording: `countBeats` count-in clicks, then `onDownbeat` fires on the
  // next beat (when recording starts). If recordMetro is true the clicks continue
  // through the recording; otherwise the grid stops at the downbeat (count-in
  // only, silent recording). If the metronome is ALREADY free-running (practice),
  // the count-in continues that same grid with no restart/seam — so "1,2,3,4"
  // lands exactly in tempo. With no AudioContext (tests) onDownbeat is synchronous.
  function armRecord({ countBeats = 4, recordMetro = false, onDownbeat } = {}) {
    if (!AC) { if (onDownbeat) onDownbeat(); return; }
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    if (running && timer) {
      // Continue the running grid: count `countBeats` from the next scheduled beat.
      session = { countBeats: beat + countBeats, recordMetro, onDownbeat, fired: false };
    } else {
      if (timer) { clearInterval(timer); timer = null; }
      session = { countBeats, recordMetro, onDownbeat, fired: false };
      running = true;
      beat = 0;
      nextTime = ctx.currentTime + 0.12;
      timer = setInterval(scheduler, LOOKAHEAD_MS);
    }
  }

  return { start, stop, toggle, setTempo, getTempo, isRunning, armRecord, getArmedDownbeat: () => armedDownbeat, getCtxTime: () => (ctx ? ctx.currentTime : 0) };
}
