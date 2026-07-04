// src/tab/tab-midi-player.js — plays a transcribed tab as synthesized notes,
// so the player can hear the TAB itself (independent of the recorded audio).
// A short plucked-string-ish voice per note (triangle + lowpass + fast decay).
// Drives a per-frame onTick(tabTimeSec) so the lane cursor can ride along.
// Works even with the amp engine off — it makes its own AudioContext then.

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createTabMidiPlayer({ getContext } = {}) {
  let own = null;
  let ctx = null;
  let voices = [];
  let master = null;
  let raf = 0;
  let playing = false;

  function resolveCtx() {
    const live = getContext && getContext();
    ctx = live || own || (own = AC ? new AC() : null);
    return ctx;
  }

  function stop() {
    playing = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    const now = ctx ? ctx.currentTime : 0;
    for (const v of voices) {
      try { v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.01); } catch {}
      try { v.o.stop(now + 0.05); } catch {}
    }
    voices = [];
    if (master) { try { master.disconnect(); } catch {} master = null; }
  }

  // notes: [{ tSec, durSec, midi }] — tSec/durSec in seconds from tab start.
  function play(notes, { onTick, onEnd } = {}) {
    stop();
    if (!resolveCtx()) return false;
    if (ctx.state === 'suspended') ctx.resume();
    const usable = (notes || []).filter((n) => n.midi != null && n.tSec != null).sort((a, b) => a.tSec - b.tSec);
    if (!usable.length) { if (onEnd) onEnd(); return false; }

    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);

    const t0 = ctx.currentTime + 0.06;
    let end = 0;
    for (const n of usable) {
      const start = t0 + n.tSec;
      const dur = Math.min(Math.max(n.durSec || 0.3, 0.12), 1.2);
      end = Math.max(end, n.tSec + dur);
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
      voices.push({ o, g });
    }

    playing = true;
    const total = end + 0.12;
    const tick = () => {
      if (!playing) return;
      const t = ctx.currentTime - t0;
      if (t >= total) { stop(); if (onTick) onTick(t); if (onEnd) onEnd(); return; }
      if (onTick) onTick(Math.max(0, t));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return true;
  }

  return { play, stop, isPlaying: () => playing };
}
