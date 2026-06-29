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
  let nodes = new Map(); // trackId -> { gain, pan }

  // groups: [{ id, takes, gain, pan }] — one mixer strip per track.
  function play(groups, fromSec = 0, onTick, onEnd) {
    if (playing || !AC) return;
    const flat = groups.flatMap((g) => g.takes || []);
    const dur = playbackDuration(flat);
    if (dur <= 0 || fromSec >= dur) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.06;
    sources = []; nodes = new Map();
    for (const g of groups) {
      const gain = ctx.createGain();
      gain.gain.value = g.gain == null ? 1 : g.gain;
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = g.pan || 0;
        gain.connect(pan); pan.connect(ctx.destination);
        nodes.set(g.id, { gain, pan });
      } else {
        gain.connect(ctx.destination);
        nodes.set(g.id, { gain });
      }
      for (const tk of (g.takes || [])) {
        if (!tk.samples || !tk.samples.length) continue;
        const start = (tk.x || 0) / PX_PER_SEC;
        const end = start + (tk.duration || 0);
        if (end <= fromSec) continue;
        const buf = ctx.createBuffer(1, tk.samples.length, tk.sampleRate);
        if (buf.copyToChannel) buf.copyToChannel(tk.samples, 0); else buf.getChannelData(0).set(tk.samples);
        const s = ctx.createBufferSource();
        s.buffer = buf; s.connect(gain);
        const rel = start - fromSec;
        if (rel >= 0) s.start(t0 + rel); else s.start(t0, -rel);
        sources.push(s);
      }
    }
    playing = true;
    const tick = () => {
      const pos = fromSec + (ctx.currentTime - t0);
      if (pos >= dur) { stop(); if (onEnd) onEnd(); return; }
      if (onTick) onTick(Math.max(0, pos));
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function setTrackGain(id, g) { const n = nodes.get(id); if (n) n.gain.gain.setTargetAtTime(g, ctx.currentTime, 0.01); }
  function setTrackPan(id, p) { const n = nodes.get(id); if (n && n.pan) n.pan.pan.setTargetAtTime(p, ctx.currentTime, 0.01); }

  function stop() {
    playing = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    for (const s of sources) { try { s.stop(); } catch {} }
    sources = []; nodes = new Map();
  }

  function isPlaying() { return playing; }
  return { play, stop, isPlaying, setTrackGain, setTrackPan };
}
