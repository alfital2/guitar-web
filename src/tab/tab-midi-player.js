// src/tab/tab-midi-player.js — plays a transcribed tab as synthesized notes,
// so the player can hear the TAB itself (independent of the recorded audio).
// A short plucked-string-ish voice per note (triangle + lowpass + fast decay);
// metronome/count-in clicks are sine blips (accented beat 1 at 1000Hz).
// Drives a per-frame onTick(tabTimeSec) so the lane cursor can ride along.
// Works even with the amp engine off — it makes its own AudioContext then.
//
// Scheduling is the metronome.js "two clocks" lookahead pattern: a ~50ms
// setInterval schedules only the next 200ms of audio on the AudioContext
// clock. Long tabs never pre-build hundreds of nodes, and the loop region
// repeats with NO seam — iteration n+1 is scheduled on the same audio grid
// before iteration n ends (never restart-on-end). All musical times live on
// the PRE-SPEED tab timeline; audio time = t0 + t/speed, so the practice
// speed control scales everything uniformly (pitch untouched — synth, not
// audio stretch). A count-in bar occupies "unwrapped" time [0, countSec)
// BEFORE the playing region starts.

import { barTicks, ticksToSec } from './tab-model.js';

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const LOOKAHEAD_MS = 50;      // how often the scheduler wakes
const SCHEDULE_AHEAD = 0.2;   // seconds of audio scheduled in advance

// Practice speed: 50–100%. Anything non-finite means "normal".
export function clampSpeed(v) {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0.5, Math.min(1, v));
}

// The beat unit follows the TS denominator (6/8 clicks eighths), the accent
// follows the numerator (beat 1 of each bar).
export function beatSeconds(tempo, den = 4) { return (60 / tempo) * (4 / den); }
export function barSeconds(tempo, timeSig = { num: 4, den: 4 }) {
  return timeSig.num * beatSeconds(tempo, timeSig.den);
}

// Loop window (pre-speed seconds) for a tick selection, expanded to whole
// bars so the wrap always lands on a downbeat. No selection → the whole tab,
// rounded up to a full bar (an empty tab still yields one bar).
export function loopWindow(state, selection = null) {
  const bt = barTicks(state.timeSig);
  let a, b;
  if (selection) {
    const lo = Math.min(selection.startTick, selection.endTick);
    const hi = Math.max(selection.startTick, selection.endTick);
    a = Math.floor(lo / bt) * bt;
    b = Math.max(a + bt, Math.ceil(hi / bt) * bt);
  } else {
    const lastEnd = (state.notes || []).reduce((m, n) => Math.max(m, n.tick + n.durTicks), 0);
    a = 0;
    b = Math.max(bt, Math.ceil(lastEnd / bt) * bt);
  }
  return { startSec: ticksToSec(a, state.tempo), endSec: ticksToSec(b, state.tempo) };
}

export function createTabMidiPlayer({ getContext } = {}) {
  let own = null;
  let ctx = null;
  let master = null;
  let timer = null;
  let raf = 0;
  let playing = false;
  const live = new Set();     // scheduled/sounding voices: { o, g }

  function resolveCtx() {
    const liveCtx = getContext && getContext();
    ctx = liveCtx || own || (own = AC ? new AC() : null);
    return ctx;
  }

  function stop() {
    playing = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const now = ctx ? ctx.currentTime : 0;
    for (const v of live) {
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.01); } catch {}
      try { v.o.stop(now + 0.05); } catch {}
    }
    live.clear();
    if (master) { try { master.disconnect(); } catch {} master = null; }
  }

  // notes: [{ tSec, durSec, midi, tech }] — pre-speed seconds from tab start.
  // loop: { startSec, endSec } pre-speed — the region repeats until stop().
  function play(notes, {
    onTick, onEnd, speed = 1,
    metronome = false, countIn = false, loop = null,
    timeSig = { num: 4, den: 4 }, tempo = 120,
  } = {}) {
    stop();
    if (!resolveCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    const spd = clampSpeed(speed);
    const usable = (notes || []).filter((n) => n.midi != null && n.tSec != null).sort((a, b) => a.tSec - b.tSec);
    if (!usable.length) { if (onEnd) onEnd(); return false; }

    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.06;
    const clampDur = (d) => Math.min(Math.max(d || 0.3, 0.12), 1.2);
    let end = 0;
    for (const n of usable) end = Math.max(end, n.tSec + clampDur(n.durSec));

    const beat = beatSeconds(tempo, timeSig.den);
    const countSec = countIn ? barSeconds(tempo, timeSig) : 0;
    const region = loop && loop.endSec > loop.startSec
      ? { start: Math.max(0, loop.startSec), end: loop.endSec }
      : null;
    const rStart = region ? region.start : 0;
    const rEnd = region ? region.end : end;
    const span = rEnd - rStart;

    // Count-in clicks sit on the unwrapped timeline [0, countSec) BEFORE the
    // playing region; `iter` is ONE pass of the region (rel = pre-speed
    // seconds from region start). Non-loop playback is just a single pass.
    // Metronome beats stay on the tab's ABSOLUTE grid, so accents keep
    // meaning "bar 1" even when the loop starts mid-tab.
    const pre = [];
    if (countIn) for (let k = 0; k < timeSig.num; k++) pre.push({ u: k * beat, accent: k === 0 });

    const iter = [];
    if (metronome) {
      const k0 = Math.ceil(rStart / beat - 1e-9);
      for (let k = k0; k * beat < rEnd - 1e-9; k++) {
        iter.push({ rel: k * beat - rStart, click: true, accent: k % timeSig.num === 0 });
      }
    }
    for (const n of usable) {
      if (region && (n.tSec < rStart || n.tSec >= rEnd)) continue;
      iter.push({ rel: n.tSec - rStart, note: n });
    }
    iter.sort((a, b) => a.rel - b.rel);

    const totalU = countSec + span + 0.12;         // non-loop end (unwrapped)

    function voice(n, start) {
      const dur = clampDur(n.durSec) / spd;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToFreq(n.midi);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(6000, midiToFreq(n.midi) * 6);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.9, start + 0.006);   // pluck attack
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);  // string decay
      o.connect(lp); lp.connect(g); g.connect(master);
      o.start(start);
      o.stop(start + dur + 0.05);
      const v = { o, g };
      live.add(v);
      o.onended = () => { live.delete(v); try { o.disconnect(); } catch {} try { g.disconnect(); } catch {} };
    }

    // Click blip — metronome.js voice, routed through master so stop() kills it.
    function click(at, accent) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1000 : 800;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.33, at + 0.001);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      o.connect(g); g.connect(master);
      o.start(at); o.stop(at + 0.06);
      const v = { o, g };
      live.add(v);
      o.onended = () => { live.delete(v); try { o.disconnect(); } catch {} try { g.disconnect(); } catch {} };
    }

    // Chunked lookahead: schedule whatever lands inside the horizon, then go
    // back to sleep. Looping = walking the SAME iteration list with a lap
    // offset (lap * span) — the next pass is on the grid before this one
    // ends, so there is no seam. Non-loop: the timer stops once everything
    // is scheduled; the rAF ride below finishes the run and fires onEnd.
    let preIdx = 0, i = 0, lap = 0;
    function scheduler() {
      const horizon = ctx.currentTime + SCHEDULE_AHEAD;
      while (preIdx < pre.length) {
        const at = t0 + pre[preIdx].u / spd;
        if (at >= horizon) return;
        click(at, pre[preIdx].accent);
        preIdx++;
      }
      if (!iter.length) { if (!region && timer) { clearInterval(timer); timer = null; } return; }
      for (;;) {
        if (i >= iter.length) {
          if (!region) { if (timer) { clearInterval(timer); timer = null; } return; }
          lap++; i = 0;
        }
        const ev = iter[i];
        const at = t0 + (countSec + lap * span + ev.rel) / spd;
        if (at >= horizon) return;
        if (ev.click) click(at, ev.accent); else voice(ev.note, at);
        i++;
      }
    }

    playing = true;
    timer = setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();

    const tick = () => {
      if (!playing) return;
      const U = (ctx.currentTime - t0) * spd;      // audio elapsed → unwrapped tab time
      const p = Math.max(0, U - countSec);         // time into the playing region(s)
      if (region) {
        if (onTick) onTick(rStart + (p % span));   // wraps: stays in [start, end)
        raf = requestAnimationFrame(tick);
        return;
      }
      if (U >= totalU) { stop(); if (onTick) onTick(p); if (onEnd) onEnd(); return; }
      if (onTick) onTick(p);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return true;
  }

  return { play, stop, isPlaying: () => playing };
}
