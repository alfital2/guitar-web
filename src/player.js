// src/player.js
// Plays recorded takes back through an own AudioContext (works when the engine
// is stopped) and drives a playhead clock. playbackDuration is pure/testable.
import { PX_PER_SEC } from './track-lane.js';

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

export function playbackDuration(takes) {
  return takes.reduce((max, t) => Math.max(max, (t.x || 0) / PX_PER_SEC + (t.duration || 0)), 0);
}

export function createPlayer() {
  let ctx = null, sources = [], playing = false, raf = null;

  function play(takes, onTick, onEnd) {
    if (playing || !AC) return;
    const dur = playbackDuration(takes);
    if (dur <= 0) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.06;
    sources = [];
    for (const tk of takes) {
      if (!tk.samples || !tk.samples.length) continue;
      const buf = ctx.createBuffer(1, tk.samples.length, tk.sampleRate);
      if (buf.copyToChannel) buf.copyToChannel(tk.samples, 0); else buf.getChannelData(0).set(tk.samples);
      const s = ctx.createBufferSource();
      s.buffer = buf; s.connect(ctx.destination);
      s.start(t0 + (tk.x || 0) / PX_PER_SEC);
      sources.push(s);
    }
    playing = true;
    const tick = () => {
      const elapsed = ctx.currentTime - t0;
      if (elapsed >= dur) { stop(); if (onEnd) onEnd(); return; }
      if (onTick) onTick(Math.max(0, elapsed));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function stop() {
    playing = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    for (const s of sources) { try { s.stop(); } catch {} }
    sources = [];
  }

  function isPlaying() { return playing; }
  return { play, stop, isPlaying };
}
