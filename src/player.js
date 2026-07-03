// src/player.js
// Plays recorded takes back through an own AudioContext (works when the engine
// is stopped) and drives a playhead clock. playbackDuration is pure/testable.
import { PX_PER_SEC } from './track-lane.js';

const AC = typeof AudioContext !== 'undefined' ? AudioContext
  : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null);

const takeLen = (t) => (t.len != null ? t.len : (t.duration || 0));
const takeRep = (t) => (t.repeat && t.repeat > 1 ? t.repeat : 1);
// Full visible span in seconds: the trim window times its loop repetitions.
const takeSpan = (t) => takeLen(t) * takeRep(t);

export function playbackDuration(takes) {
  return takes.reduce((max, t) => Math.max(max, (t.x || 0) / PX_PER_SEC + takeSpan(t)), 0);
}

// Pure: buffer-source schedule for a take when playback starts at transport
// second `fromSec`. One entry per (partial) repetition still ahead: `when` is
// seconds after playback start (≥ 0), `offset`/`dur` the buffer window to play.
// A looped take (repeat > 1) replays its window back to back; the final
// repetition is truncated when `repeat` is fractional, and a start that lands
// mid-repetition begins that repetition further into its window.
export function takeSchedule(tk, fromSec = 0) {
  const len = takeLen(tk);
  const offset = tk.offset || 0;
  const start = (tk.x || 0) / PX_PER_SEC;
  const out = [];
  if (!(len > 0)) return out;
  const rep = takeRep(tk);
  const n = Math.ceil(rep - 1e-9);
  for (let i = 0; i < n; i++) {
    const dur = Math.min(len, (rep - i) * len);  // last repetition may be partial
    const rel = start + i * len - fromSec;
    if (rel + dur <= 0) continue;                // this repetition already passed
    if (rel >= 0) out.push({ when: rel, offset, dur });
    else out.push({ when: 0, offset: offset - rel, dur: dur + rel }); // start mid-repetition
  }
  return out;
}

// `getContext` (optional) supplies the LIVE app AudioContext. Sharing it puts
// playback, the live chain and the recorder on ONE clock and one output-latency
// domain — critical for overdubbing: with the old private context (default
// latency) plus a fat 60 ms pre-delay, the backing a player heard ran ~60-90 ms
// behind the take anchor, so overdubbed leads landed audibly late.
export function createPlayer({ getContext } = {}) {
  let own = null, sources = [], playing = false, raf = null;
  let ctx = null;
  let nodes = new Map(); // trackId -> { gain, pan }
  const SCHED_AHEAD = 0.03; // just enough to schedule race-free

  // groups: [{ id, takes, gain, pan }] — one mixer strip per track.
  // Returns the exact ctx time playback was scheduled at (t0) — the overdub
  // recorder aligns its take against it — or null if nothing played.
  function play(groups, fromSec = 0, onTick, onEnd) {
    if (playing || !AC) return null;
    const flat = groups.flatMap((g) => g.takes || []);
    const dur = playbackDuration(flat);
    if (dur <= 0 || fromSec >= dur) return null;
    const live = getContext && getContext();
    ctx = live || own || (own = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + SCHED_AHEAD;
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
        // One buffer per take, one source per (partial) repetition: a looped
        // take replays its trimmed window [offset, offset+len) back to back.
        const windows = takeSchedule(tk, fromSec);
        if (!windows.length) continue;
        const buf = ctx.createBuffer(1, tk.samples.length, tk.sampleRate);
        if (buf.copyToChannel) buf.copyToChannel(tk.samples, 0); else buf.getChannelData(0).set(tk.samples);
        for (const w of windows) {
          const s = ctx.createBufferSource();
          s.buffer = buf; s.connect(gain);
          s.start(t0 + w.when, w.offset, w.dur);
          sources.push(s);
        }
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
    return t0;
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
