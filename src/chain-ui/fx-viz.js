// src/chain-ui/fx-viz.js — tune-to-animate pedal-screen visualizations.
//
// Every pedal's screen (the .pedal-plate lens area) shows a tiny honest diagram
// of what the effect does to sound at the CURRENT knob settings. At rest the
// screen is a STILL, param-true frame (like the wah's response curve). While
// the user is TUNING a knob the animation plays — it explains what the param
// does (echoes replay, the comb sweeps, the horn spins) — and once tuning
// stops the motion decelerates smoothly to a stop (user direction 2026-07-02:
// "animation playing only when tuning; once user stopped, it stops slowly").
//
// Mechanism: one shared low-rate poller compares each pedal's live params
// against the last-drawn signature. A change kicks that pedal's animation
// clock to full speed; after a short hold the clock's velocity decays each
// tick until the screen freezes at its final pose (no snap-back). Idle screens
// cost one string compare per poll; nothing runs while the tab is hidden.
//
// Truth requirements (design spec 2026-07-02 §3): the drive family evaluates
// the SAME WaveShaper curves the audio path uses (imported from dsp.js), and
// the EQ plots the real biquad magnitude response of its three filters.
import {
  makeSoftClipCurve, makeHardClipCurve, makeDistortionCurve, makeRectifierCurve,
  mapRange,
} from '../dsp.js';
import { FX_COLORS } from './fx-art.js';

const TAU = Math.PI * 2;

// The real curve makers, routed through a mutable table so tests can spy on
// them and prove the viz draws the same math the audio runs.
export const CURVES = { makeSoftClipCurve, makeHardClipCurve, makeDistortionCurve, makeRectifierCurve };

// ---------------------------------------------------------------------------
// small drawing helpers
// ---------------------------------------------------------------------------
function col(type) { return FX_COLORS[type] || '#9aa0a6'; }

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Stroke fn(u)→y over x∈[x0,x1] as a polyline (u runs 0..1).
function plot(g, fn, x0, x1, steps = 56) {
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, x = x0 + (x1 - x0) * u, y = fn(u);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
}

// WaveShaper transfer-curve lookup: exactly what the audio-thread shaper does
// with an input sample x∈[-1,1].
function shape(curve, x) {
  const n = curve.length;
  const i = Math.max(0, Math.min(n - 1, Math.round(((x + 1) / 2) * (n - 1))));
  return curve[i];
}

// Cache built curves by maker + amount so redraws don't rebuild the
// Float32Array. Values key the cache, so any knob move rebuilds.
const curveCache = new Map();
function curveOf(name, amount) {
  const key = name + ':' + amount;
  let c = curveCache.get(key);
  if (!c) {
    c = CURVES[name](amount);
    if (curveCache.size > 48) curveCache.clear();
    curveCache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------------------
// param-true math: biquad magnitude response (Web Audio / RBJ formulas)
// ---------------------------------------------------------------------------
function biquadCoeffs(type, f0, Q, gainDb, fs) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = TAU * f0 / fs;
  const cw = Math.cos(w0), sw = Math.sin(w0);
  if (type === 'peaking') {
    const alpha = sw / (2 * Q);
    return {
      b0: 1 + alpha * A, b1: -2 * cw, b2: 1 - alpha * A,
      a0: 1 + alpha / A, a1: -2 * cw, a2: 1 - alpha / A,
    };
  }
  // shelves use the Web Audio fixed slope S=1
  const alpha = (sw / 2) * Math.SQRT2;
  const sA = 2 * Math.sqrt(A) * alpha;
  if (type === 'lowshelf') {
    return {
      b0: A * ((A + 1) - (A - 1) * cw + sA),
      b1: 2 * A * ((A - 1) - (A + 1) * cw),
      b2: A * ((A + 1) - (A - 1) * cw - sA),
      a0: (A + 1) + (A - 1) * cw + sA,
      a1: -2 * ((A - 1) + (A + 1) * cw),
      a2: (A + 1) + (A - 1) * cw - sA,
    };
  }
  // highshelf
  return {
    b0: A * ((A + 1) + (A - 1) * cw + sA),
    b1: -2 * A * ((A - 1) + (A + 1) * cw),
    b2: A * ((A + 1) + (A - 1) * cw - sA),
    a0: (A + 1) - (A - 1) * cw + sA,
    a1: 2 * ((A - 1) - (A + 1) * cw),
    a2: (A + 1) - (A - 1) * cw - sA,
  };
}

export function biquadMagDb(type, f0, Q, gainDb, freq, fs = 48000) {
  const { b0, b1, b2, a0, a1, a2 } = biquadCoeffs(type, f0, Q, gainDb, fs);
  const w = TAU * freq / fs;
  const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
  const dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di) + 1e-24);
}

// The EQ pedal's actual response: lowshelf 120Hz + peaking(midFreq, Q=1) +
// highshelf 3kHz, each ±12dB from its 0..10 knob (mirrors src/effects/eq.js).
export function eqResponseDb(p, freqs, fs = 48000) {
  const toDb = (v) => mapRange(v ?? 5, 0, 10, -12, 12);
  return freqs.map((f) =>
    biquadMagDb('lowshelf', 120, 1, toDb(p.bass), f, fs) +
    biquadMagDb('peaking', p.midFreq ?? 750, 1, toDb(p.mid), f, fs) +
    biquadMagDb('highshelf', 3000, 1, toDb(p.treble), f, fs));
}

// ---------------------------------------------------------------------------
// per-effect draw functions — VIZ[type](g, t, params, w, h)
// All draws are STATIC: `t` is accepted for API stability but ignored; every
// visual feature is a function of the params only.
// ---------------------------------------------------------------------------

// delay family: dry pulse + decaying echo bars. Spacing tracks Time, bar count
// and decay track Feedback; tape flutter jitters the bars.
function echoViz(type, { alternate = false, wobble = false, tMin = 0, tMax = 1000 } = {}) {
  const c = col(type);
  return (g, t, p, w, h) => {
    const base = h * 0.74;
    g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1;
    g.beginPath(); g.moveTo(6, base); g.lineTo(w - 6, base); g.stroke();

    const dx = mapRange(p.time ?? 300, tMin, tMax, 7, w * 0.36);
    const decay = 0.3 + 0.66 * ((p.feedback ?? 0.3) / 0.9);
    const flut = wobble ? (p.flutter ?? 3) : 0;
    const bars = [];
    let x = 9, amp = 1;
    while (x < w - 6 && amp > 0.05 && bars.length < 14) { bars.push({ x, amp }); x += dx; amp *= decay; }
    bars.forEach((b, i) => {
      const wob = flut ? Math.sin(i * 1.9) * flut * 0.55 : 0;
      const hgt = b.amp * h * 0.5;
      const up = !(alternate && i % 2);
      g.fillStyle = hexA(c, i === 0 ? 0.95 : 0.45 + 0.45 * b.amp);
      if (up) g.fillRect(b.x - 1.5, base - hgt + wob, 3, hgt);
      else g.fillRect(b.x - 1.5, base + wob - h * 0.06, 3, hgt * 0.55);
    });
  };
}

// spectrum-hump family (wah / autowah): a bandpass peak on a baseline.
function humpViz(type, centerFn, ghostsFn = null) {
  const c = col(type);
  return (g, t, p, w, h) => {
    const mid = h * 0.68;
    const q = (p.resonance ?? 8) / 20;             // 0..1
    const peak = h * (0.2 + 0.34 * q);
    const width = 0.05 + 0.22 * (1 - q);
    const hump = (cx, alpha, lw) => {
      g.strokeStyle = hexA(c, alpha); g.lineWidth = lw;
      plot(g, (u) => {
        const d = (u - cx) / width;
        return mid - peak * Math.exp(-d * d);
      }, 6, w - 6);
    };
    // sweep-extent ghosts first (autowah), then the main hump on top
    if (ghostsFn) for (const [cx, a] of ghostsFn(p)) hump(cx, a, 1.2);
    hump(centerFn(p), 0.9, 1.8);
    g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1;
    g.beginPath(); g.moveTo(6, mid); g.lineTo(w - 6, mid); g.stroke();
  };
}

// drive family: the input sine (ghost) against the SAME transfer curve the
// audio WaveShaper uses — mathematically true clipping.
function clipViz(type, curveName, amountKey) {
  const c = col(type);
  return (g, t, p, w, h) => {
    const curve = curveOf(curveName, p[amountKey] ?? 5);
    const mid = h / 2, amp = h * 0.34;
    g.strokeStyle = hexA(c, 0.28); g.lineWidth = 1.2;
    plot(g, (u) => mid - Math.sin(TAU * u * 2) * amp, 6, w - 6, 64);
    g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
    plot(g, (u) => mid - shape(curve, Math.sin(TAU * u * 2)) * amp, 6, w - 6, 96);
  };
}

// pitch family: reference wave + shifted wave at the true frequency ratio.
function pitchWave(g, c, w, h, yC, cycles, alpha) {
  g.strokeStyle = hexA(c, alpha); g.lineWidth = 1.7;
  plot(g, (u) => yC - Math.sin(TAU * u * cycles) * h * 0.13, 6, w - 6, 72);
}

export const VIZ = {};

VIZ.delay = echoViz('delay');
VIZ.pingpong = echoViz('pingpong', { alternate: true, tMin: 60, tMax: 800 });
VIZ['tape-echo'] = echoViz('tape-echo', { wobble: true, tMin: 40, tMax: 800 });

VIZ.reverb = (g, t, p, w, h) => {
  const c = col('reverb');
  const base = h * 0.76, size = p.size ?? 0.5, mix = p.mix ?? 0.12;
  const span = w * (0.3 + 0.6 * size);
  g.fillStyle = hexA(c, 0.95);
  g.fillRect(9, base - h * 0.5, 3, h * 0.5); // impulse
  const n = 22;
  for (let i = 1; i <= n; i++) {
    const u = i / n, x = 12 + span * u;
    if (x > w - 6) break;
    const env = Math.pow(1 - u, 1.7);
    const grain = 0.8 + 0.2 * Math.sin(i * 2.6); // static tail texture
    g.fillStyle = hexA(c, (0.14 + 0.72 * mix) * env * grain + 0.06);
    const hgt = h * 0.42 * env;
    g.fillRect(x - 1, base - hgt, 2, hgt);
  }
};

VIZ.springverb = (g, t, p, w, h) => {
  const c = col('springverb');
  const mid = h * 0.52;
  const coils = Math.round(7 + ((p.tension ?? 5) / 10) * 8); // tension = tighter spring
  const tail = 0.15 + ((p.decay ?? 5) / 10) * 0.5;           // ripple trail length
  const head = 0.38;                                          // fixed chirp position
  g.lineWidth = 1.7;
  g.beginPath();
  const N = coils * 8;
  for (let i = 0; i <= N; i++) {
    const u = i / N, x = 8 + (w - 16) * u;
    let d = head - u; if (d < 0) d += 1;
    const ring = d < tail ? (1 - d / tail) : 0; // dispersive chirp ripple
    const y = mid + Math.sin(u * TAU * coils) * (h * 0.1 + h * 0.16 * ring);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.strokeStyle = hexA(c, 0.55 + 0.4 * (p.mix ?? 0.35));
  g.stroke();
};

VIZ.chorus = (g, t, p, w, h) => {
  const c = col('chorus');
  const mid = h / 2, depth = (p.depth ?? 4) / 10;
  const spread = 0.5 + Math.min(p.rate ?? 1.5, 10) * 0.16; // rate widens voice offsets
  for (let k = 0; k < 3; k++) {
    const det = (k - 1) * depth * 0.5;
    const off = (k - 1) * depth * spread;
    g.strokeStyle = hexA(c, k === 1 ? 0.95 : 0.25 + 0.55 * (p.mix ?? 0.4));
    g.lineWidth = k === 1 ? 1.8 : 1.3;
    plot(g, (u) => mid - Math.sin(TAU * u * (2.4 + det * 0.4) + off) * h * 0.27, 6, w - 6, 64);
  }
};

VIZ.flanger = (g, t, p, w, h) => {
  const c = col('flanger');
  const mid = h * 0.32;
  const teeth = 3 + Math.min(p.rate ?? 0.4, 8);   // rate = comb density
  const depth = h * 0.42 * ((p.depth ?? 5) / 10);
  const sharp = 1 + (p.feedback ?? 0.5) * 3;      // feedback sharpens the teeth
  g.strokeStyle = hexA(c, 0.92); g.lineWidth = 1.8;
  plot(g, (u) => {
    const comb = 0.5 + 0.5 * Math.cos(u * TAU * teeth);
    return mid + depth * Math.pow(comb, 1 / sharp);
  }, 6, w - 6, 96);
};

VIZ.phaser = (g, t, p, w, h) => {
  const c = col('phaser');
  const mid = h * 0.5, notches = 3;
  const depth = h * 0.3 * ((p.depth ?? 6) / 10);
  const spacing = 0.17 + 0.13 * (Math.min(p.rate ?? 0.5, 8) / 8); // rate spreads notches
  const centers = [];
  for (let k = 0; k < notches; k++) centers.push(0.5 + (k - 1) * spacing);
  const yAt = (u) => {
    let y = mid;
    for (const cx of centers) { const d = (u - cx) / 0.06; y += depth * Math.exp(-d * d); }
    return y;
  };
  g.strokeStyle = hexA(c, 0.9); g.lineWidth = 1.8;
  plot(g, yAt, 6, w - 6, 96);
  g.fillStyle = hexA(c, 0.9);
  for (const cx of centers) {
    const x = 6 + (w - 12) * cx;
    g.beginPath(); g.arc(x, yAt(cx) + 3, 2, 0, TAU); g.fill();
  }
};

VIZ.vibrato = (g, t, p, w, h) => {
  const c = col('vibrato');
  const mid = h / 2;
  const m = ((p.depth ?? 4) / 10) * 0.35;                      // depth = breath amount
  const cycles = 0.5 + (Math.min(p.rate ?? 5, 10) / 10) * 2;   // rate = breaths across screen
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
  plot(g, (u) => mid - Math.sin(TAU * u * 3 * (1 + m * Math.sin(TAU * u * cycles))) * h * 0.3, 6, w - 6, 96);
};

VIZ.tremolo = (g, t, p, w, h) => {
  const c = col('tremolo');
  const mid = h / 2, depth = p.depth ?? 0.6, square = (p.shape ?? 0) >= 0.5;
  const cycles = 1 + (Math.min(p.rate ?? 5, 12) / 12) * 3;     // rate = LFO cycles shown
  const lfo = (x) => { const s = Math.sin(x); return square ? (Math.sign(s) || 1) : s; };
  const env = (u) => 1 - depth * (0.5 + 0.5 * lfo(TAU * u * cycles));
  g.strokeStyle = hexA(c, 0.35); g.lineWidth = 1.1;
  plot(g, (u) => mid - env(u) * h * 0.34, 6, w - 6, 72);
  plot(g, (u) => mid + env(u) * h * 0.34, 6, w - 6, 72);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.6;
  plot(g, (u) => mid - Math.sin(TAU * u * 8) * env(u) * h * 0.34, 6, w - 6, 128);
};

VIZ.rotary = (g, t, p, w, h) => {
  const c = col('rotary');
  const cx = w / 2, cy = h / 2;
  const rx = w * 0.3, ry = Math.max(h * 0.16 * (0.4 + 0.6 * ((p.depth ?? 6) / 10)), 1);
  const a = 0.6; // fixed horn pose
  g.strokeStyle = hexA(c, 0.35); g.lineWidth = 1.2;
  g.beginPath();
  if (g.ellipse) g.ellipse(cx, cy, rx, ry, 0, 0, TAU); else g.arc(cx, cy, rx, 0, TAU);
  g.stroke();
  // speed = length of the motion-trail dots behind each horn
  const trail = mapRange(p.speed ?? 6, 0, 10, 0.06, 1.5);
  for (const flip of [0, Math.PI]) {
    for (let s = 1; s <= 3; s++) {
      const aa = a + flip - (trail * s) / 3;
      g.fillStyle = hexA(c, 0.55 * (1 - s / 4));
      g.beginPath(); g.arc(cx + Math.cos(aa) * rx, cy + Math.sin(aa) * ry, 2, 0, TAU); g.fill();
    }
  }
  const x1 = cx + Math.cos(a) * rx, y1 = cy + Math.sin(a) * ry;
  const x2 = cx - Math.cos(a) * rx, y2 = cy - Math.sin(a) * ry;
  g.strokeStyle = hexA(c, 0.85); g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.fillStyle = hexA(c, 0.95);
  g.beginPath(); g.arc(x1, y1, 3.4, 0, TAU); g.fill();
  g.beginPath(); g.arc(x2, y2, 2.6, 0, TAU); g.fill();
};

VIZ.autopan = (g, t, p, w, h) => {
  const c = col('autopan');
  const mid = h * 0.52, depth = p.depth ?? 0.8, square = (p.shape ?? 0) >= 0.5;
  const span = Math.max(w * 0.3 * depth, 2); // depth = sweep extent
  // L / R speaker glyphs
  for (const [sx, dir] of [[10, 1], [w - 10, -1]]) {
    g.strokeStyle = hexA(c, 0.6); g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(sx, mid - 8); g.lineTo(sx + 5 * dir, mid - 3); g.lineTo(sx + 5 * dir, mid + 3); g.lineTo(sx, mid + 8);
    g.closePath(); g.stroke();
  }
  // travel line spans the sweep; rate = tick marks along it
  g.strokeStyle = hexA(c, 0.4); g.lineWidth = 1;
  g.beginPath(); g.moveTo(w / 2 - span, mid); g.lineTo(w / 2 + span, mid); g.stroke();
  const ticks = 1 + Math.round(mapRange(Math.min(p.rate ?? 2, 12), 0, 12, 0, 5));
  g.fillStyle = hexA(c, 0.45);
  for (let i = 0; i < ticks; i++) {
    const x = w / 2 - span + (2 * span) * (ticks === 1 ? 0.5 : i / (ticks - 1));
    g.fillRect(x - 0.75, mid - 3, 1.5, 6);
  }
  // pan poles at the sweep extremes; square LFO = square markers
  const mark = (x, alpha) => {
    g.fillStyle = hexA(c, alpha);
    if (square) g.fillRect(x - 3.5, mid - 3.5, 7, 7);
    else { g.beginPath(); g.arc(x, mid, 4, 0, TAU); g.fill(); }
  };
  mark(w / 2 + span, 0.95);
  mark(w / 2 - span, 0.35);
};

VIZ.ringmod = (g, t, p, w, h) => {
  const c = col('ringmod');
  const mid = h / 2, mix = p.mix ?? 0.5;
  const n = mapRange(Math.log10(Math.max(p.freq ?? 220, 20)), Math.log10(20), Math.log10(2000), 3, 15);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.7;
  plot(g, (u) => {
    const carrier = Math.sin(TAU * u * 2.2);
    const prod = carrier * Math.sin(TAU * u * n);
    return mid - ((1 - mix) * carrier + mix * prod) * h * 0.32;
  }, 6, w - 6, 128);
};

VIZ.drive = clipViz('drive', 'makeSoftClipCurve', 'amount');
VIZ.fuzz = clipViz('fuzz', 'makeHardClipCurve', 'fuzz');
VIZ.distortion = clipViz('distortion', 'makeDistortionCurve', 'dist');

VIZ.octave = (g, t, p, w, h) => {
  const c = col('octave');
  const curve = curveOf('makeRectifierCurve', p.octave ?? 0.7); // the REAL rectifier
  const clip = curveOf('makeHardClipCurve', p.fuzz ?? 6);
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1.2;
  plot(g, (u) => h * 0.3 - Math.sin(TAU * u * 2) * h * 0.16, 6, w - 6, 72);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.8;
  plot(g, (u) => h * 0.68 - shape(clip, shape(curve, Math.sin(TAU * u * 2))) * h * 0.18, 6, w - 6, 96);
};

// compressor/limiter: the true gain-computer knee + a probe dot riding it.
function kneeViz(type, ratioOf) {
  const c = col(type);
  return (g, t, p, w, h) => {
    const thr = p.threshold ?? -18;             // dB
    const ratio = ratioOf(p);
    const x0 = w * 0.3, x1 = w - 8, y0 = h - 10, y1 = 8;
    const X = (dB) => x0 + (x1 - x0) * ((dB + 60) / 60);
    const Y = (dB) => y0 + (y1 - y0) * ((dB + 60) / 60);
    const outDb = (inDb) => (inDb <= thr ? inDb : thr + (inDb - thr) / ratio);
    g.strokeStyle = hexA(c, 0.25); g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, Y(0)); g.stroke(); // unity ref
    g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
    plot(g, (u) => Y(outDb(-60 + 60 * u)), x0, x1, 48);
    // probe: a signal 10dB past the threshold — shows the actual gain reduction
    const inDb = Math.min(thr + 10, 0);
    const oDb = outDb(inDb);
    g.fillStyle = hexA(c, 0.95);
    g.beginPath(); g.arc(X(inDb), Y(oDb), 2.6, 0, TAU); g.fill();
    // IN / OUT meter bars at left — their gap IS the gain reduction
    const bx = 8, bw = 5;
    g.fillStyle = hexA(c, 0.4);
    g.fillRect(bx, y0 - (y0 - y1) * ((inDb + 60) / 60), bw, (y0 - y1) * ((inDb + 60) / 60));
    g.fillStyle = hexA(c, 0.9);
    g.fillRect(bx + bw + 3, y0 - (y0 - y1) * ((oDb + 60) / 60), bw, (y0 - y1) * ((oDb + 60) / 60));
  };
}
VIZ.compressor = kneeViz('compressor', (p) => p.ratio ?? 2.5);
VIZ.limiter = kneeViz('limiter', () => 1000); // brick wall

VIZ.gate = (g, t, p, w, h) => {
  const c = col('gate');
  const mid = h / 2;
  const thr = 0.12 + ((p.threshold ?? 2) / 10) * 0.55; // display threshold 0..1
  const yT = mid - thr * h * 0.4;
  g.strokeStyle = hexA(c, 0.55); g.lineWidth = 1;
  if (g.setLineDash) g.setLineDash([3, 3]);
  g.beginPath(); g.moveTo(6, yT); g.lineTo(w - 6, yT); g.stroke();
  if (g.setLineDash) g.setLineDash([]);
  // signal: a loud burst over a noise floor; the envelope below the threshold
  // is chopped (drawn faint) — exactly what the gate does to the sound. The
  // release knob widens the burst's decaying skirt (slower gate close).
  const rel = 0.06 + ((p.release ?? 4) / 10) * 0.2;
  const env = (u) => {
    const burst = u < 0.3
      ? Math.exp(-Math.pow((0.3 - u) / 0.05, 2))
      : Math.exp(-(u - 0.3) / rel);
    const noise = 0.16 + 0.1 * Math.abs(Math.sin(u * 91) * Math.sin(u * 53));
    return Math.max(burst, noise);
  };
  const sig = (u) => env(u) * Math.sin(u * TAU * 9);
  g.lineWidth = 1.6;
  const N = 96;
  let px = 6, py = mid - sig(0) * h * 0.4, pOpen = env(0) > thr;
  g.strokeStyle = hexA(c, pOpen ? 0.95 : 0.18);
  g.beginPath(); g.moveTo(px, py);
  for (let i = 1; i <= N; i++) {
    const u = i / N, x = 6 + (w - 12) * u, y = mid - sig(u) * h * 0.4;
    const open = env(u) > thr;
    if (open !== pOpen) {
      g.stroke();
      g.strokeStyle = hexA(c, open ? 0.95 : 0.18);
      g.beginPath(); g.moveTo(px, py);
      pOpen = open;
    }
    g.lineTo(x, y);
    px = x; py = y;
  }
  g.stroke();
};

VIZ.eq = (g, t, p, w, h) => {
  const c = col('eq') || '#bf5af2';
  const freqs = [];
  const n = 48;
  for (let i = 0; i <= n; i++) freqs.push(40 * Math.pow(12000 / 40, i / n)); // log 40Hz..12k
  const resp = eqResponseDb(p, freqs);
  const mid = h * 0.52, scale = (h * 0.36) / 15; // ±15dB window
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1;
  g.beginPath(); g.moveTo(6, mid); g.lineTo(w - 6, mid); g.stroke();
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
  g.beginPath();
  resp.forEach((dB, i) => {
    const x = 6 + (w - 12) * (i / n);
    const y = mid - Math.max(-15, Math.min(15, dB)) * scale;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  });
  g.stroke();
};

VIZ.cabinet = (g, t, p, w, h) => {
  const c = col('cabinet') || '#32d74b';
  const cx = w / 2, cy = h * 0.52;
  const base = h * 0.3 * (0.7 + 0.3 * ((p.body ?? 6) / 10));
  const rings = [[1, 0.9], [0.62, 0.35 + 0.5 * ((p.brightness ?? 4) / 10)], [0.26, 0.8]];
  for (const [k, a] of rings) {
    g.strokeStyle = hexA(c, a); g.lineWidth = k === 1 ? 2 : 1.4;
    g.beginPath(); g.arc(cx, cy, base * k, 0, TAU); g.stroke();
  }
  // presence = excursion marks fanned off the dust cap
  const marks = 1 + Math.round(((p.presence ?? 5) / 10) * 3);
  g.strokeStyle = hexA(c, 0.5); g.lineWidth = 1;
  for (let i = 1; i <= marks; i++) {
    g.beginPath(); g.arc(cx, cy, base * 0.26 + i * 3, -0.5, 0.5); g.stroke();
  }
  g.fillStyle = hexA(c, 0.9);
  g.beginPath(); g.arc(cx, cy, 2.2, 0, TAU); g.fill();
};

VIZ.wah = humpViz('wah', (p) => 0.12 + 0.76 * ((p.position ?? 5) / 10));
VIZ.autowah = humpViz('autowah',
  () => 0.5,
  // envelope sweep extents as ghost humps: Range sets how far, Sens their weight
  (p) => {
    const span = 0.1 + 0.35 * ((p.range ?? 5) / 10);
    const a = 0.15 + 0.35 * ((p.sensitivity ?? 6) / 10);
    return [[0.5 - span, a], [0.5 + span, a]];
  });

VIZ.boost = (g, t, p, w, h) => {
  const c = col('boost');
  const mid = h * 0.55, gain = (p.gain ?? 6) / 24;
  const amp = h * (0.1 + 0.32 * gain);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.8;
  plot(g, (u) => mid - Math.sin(TAU * u * 2.4) * amp, 6, w * 0.7, 72);
  // level arrow, length tracks gain
  const ax = w * 0.84, ay0 = mid + h * 0.16, ay1 = ay0 - h * (0.14 + 0.42 * gain);
  g.strokeStyle = hexA(c, 0.9); g.lineWidth = 2;
  g.beginPath(); g.moveTo(ax, ay0); g.lineTo(ax, ay1); g.stroke();
  g.beginPath(); g.moveTo(ax - 4, ay1 + 6); g.lineTo(ax, ay1); g.lineTo(ax + 4, ay1 + 6); g.stroke();
};

VIZ.widener = (g, t, p, w, h) => {
  const c = col('widener');
  const cx = w / 2, top = h * 0.2, bot = h * 0.84;
  const spread = mapRange(p.width ?? 5, 0, 10, 2, w * 0.32);
  g.strokeStyle = hexA(c, 0.35); g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(cx, top); g.lineTo(cx, bot); g.stroke();
  g.strokeStyle = hexA(c, 0.92); g.lineWidth = 1.8;
  for (const dir of [-1, 1]) {
    g.beginPath(); g.moveTo(cx, top);
    g.quadraticCurveTo(cx + dir * spread * 1.15, (top + bot) / 2, cx + dir * spread, bot);
    g.stroke();
  }
};

VIZ.pitchshift = (g, t, p, w, h) => {
  const c = col('pitchshift');
  const st = p.semitones ?? -12, ratio = Math.pow(2, st / 12);
  pitchWave(g, c, w, h, h * 0.3, 2.2, 0.4);
  pitchWave(g, c, w, h, h * 0.68, 2.2 * ratio, 0.5 + 0.45 * (p.mix ?? 0.6));
};

VIZ.harmonizer = (g, t, p, w, h) => {
  const c = col('harmonizer');
  const st = p.interval ?? 7, ratio = Math.pow(2, st / 12);
  pitchWave(g, c, w, h, h * 0.3, 2.2, 0.9);
  pitchWave(g, c, w, h, h * 0.68, 2.2 * ratio, 0.25 + 0.7 * (p.mix ?? 0.5));
};

VIZ.whammy = (g, t, p, w, h) => {
  const c = col('whammy');
  const bend = (p.bend ?? 10) / 10, range = p.range ?? 12;
  const ratio = Math.pow(2, (range * bend) / 12); // treadle position = Bend knob
  const mid = h * 0.52;
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1.2;
  plot(g, (u) => mid - Math.sin(TAU * u * 2.2) * h * 0.18, 6, w - 6, 64);
  g.strokeStyle = hexA(c, 0.5 + 0.45 * (p.mix ?? 1)); g.lineWidth = 1.9;
  // frequency glides along x from unison to the bent ratio
  plot(g, (u) => mid - Math.sin(TAU * u * 2.2 * (1 + (ratio - 1) * u)) * h * 0.28, 6, w - 6, 96);
};

VIZ.looper = (g, t, p, w, h) => {
  const c = col('looper');
  const cx = w / 2, cy = h * 0.52, r = Math.min(w, h) * 0.3;
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 2.4;
  g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
  const a0 = -Math.PI / 2, prog = 0.72; // fixed loop-progress pose
  g.strokeStyle = hexA(c, 0.4 + 0.55 * (p.level ?? 0.9)); g.lineWidth = 2.6;
  g.beginPath(); g.arc(cx, cy, r, a0, a0 + prog * TAU); g.stroke();
  g.fillStyle = hexA(c, 0.95);
  g.beginPath(); g.arc(cx + Math.cos(a0 + prog * TAU) * r, cy + Math.sin(a0 + prog * TAU) * r, 3, 0, TAU); g.fill();
  const ticks = Math.round(p.mode ?? 0) + 1;
  g.fillStyle = hexA(c, 0.7);
  for (let i = 0; i < ticks; i++) {
    g.fillRect(cx - (ticks * 6 - 3) / 2 + i * 6, cy + r + 5, 3, 3);
  }
};

VIZ.acousticsim = (g, t, p, w, h) => {
  const c = col('acousticsim');
  const mid = h * 0.66;
  const body = (p.body ?? 5) / 10, air = (p.air ?? 5) / 10;
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1;
  g.beginPath(); g.moveTo(6, mid); g.lineTo(w - 6, mid); g.stroke();
  // body resonance hump (low-mid) + air sparkle shelf (top end)
  g.strokeStyle = hexA(c, 0.92); g.lineWidth = 1.8;
  plot(g, (u) => {
    const d1 = (u - 0.24) / 0.13;
    const hump = body * Math.exp(-d1 * d1);
    const shelf = air * 0.75 / (1 + Math.exp(-(u - 0.78) * 18));
    return mid - (hump + shelf) * h * 0.42;
  }, 6, w - 6, 96);
  // soundhole glyph
  g.strokeStyle = hexA(c, 0.55); g.lineWidth = 1.3;
  g.beginPath(); g.arc(w * 0.24, mid - body * h * 0.42 - 7, 3.2, 0, TAU); g.stroke();
};

VIZ.univibe = (g, t, p, w, h) => {
  const c = col('univibe');
  const mid = h / 2;
  const depth = (p.intensity ?? 6) / 10;
  const cycles = 1.5 + (Math.min(p.speed ?? 3, 8) / 8) * 2.5; // speed = wave density
  g.strokeStyle = hexA(c, 0.85); g.lineWidth = 1.7;
  plot(g, (u) => mid - Math.sin(TAU * u * cycles) * h * 0.2 * (1 - 0.4 * depth * (0.5 + 0.5 * Math.sin(TAU * u))), 6, w - 6, 72);
  // 4 staggered all-pass stages, phase-offset throb frozen mid-cycle
  for (let k = 0; k < 4; k++) {
    const u = 0.2 + k * 0.2;
    const throb = 0.5 + 0.5 * Math.sin(-k * (Math.PI / 2));
    g.fillStyle = hexA(c, 0.25 + 0.7 * throb * (0.3 + 0.7 * depth) * (0.3 + 0.7 * (p.mix ?? 0.5)));
    g.beginPath(); g.arc(6 + (w - 12) * u, h * 0.82, 2.6 + 1.6 * throb * depth, 0, TAU); g.fill();
  }
};

// ---------------------------------------------------------------------------
// registration + the single shared change-poller
// ---------------------------------------------------------------------------
const POLL_MS = 120; // ~8Hz param polling — cheap compares; draws only on change
let entries = [];
let timer = null;

// Cheap value signature of a params object; a knob move changes it.
function sigOf(p) {
  let s = '';
  for (const k in p) s += k + '=' + p[k] + ';';
  return s;
}

// Register a pedal-screen canvas. getParams() must return the LIVE params
// object for the unit (read from the chain model on each poll, so knob turns
// repaint the screen with no extra wiring). Returns false when the type has
// no viz (caller falls back to the static motif).
export function registerViz(canvas, type, getParams, opts = {}) {
  if (typeof VIZ[type] !== 'function') return false;
  entries.push({
    canvas, type, getParams, g: null,
    frozen: !!opts.bypassed, // bypassed: one dimmed static frame, then no updates
    drawn: false,
    sig: null, cw: 0, ch: 0,
  });
  if (!timer && typeof setInterval === 'function') timer = setInterval(tickViz, POLL_MS);
  return true;
}

// Drop every registered canvas (the board re-renders often; the renderer calls
// this before each rebuild so dead canvases never accumulate).
export function resetViz() {
  entries = [];
  if (timer) { clearInterval(timer); timer = null; }
}

function liveSig(e) {
  let params;
  try { params = e.getParams(); } catch { params = null; }
  return params ? sigOf(params) : null;
}

function drawEntry(e) {
  const c = e.canvas;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (!cw || !ch) return false; // not laid out yet — retry on a later poll
  const dpr = Math.min((typeof devicePixelRatio === 'number' && devicePixelRatio) || 1, 2);
  const pw = Math.round(cw * dpr), phh = Math.round(ch * dpr);
  if (c.width !== pw || c.height !== phh) { c.width = pw; c.height = phh; }
  if (!e.g) {
    try { e.g = c.getContext('2d'); } catch { e.g = null; }
    if (!e.g) return null; // no 2D context (test env) — drop the entry
  }
  const g = e.g;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  let params;
  try { params = e.getParams(); } catch { params = null; }
  if (!params) return false;
  try { VIZ[e.type](g, 0, params, cw, ch); } catch { return null; }
  e.cw = cw; e.ch = ch;
  e.sig = sigOf(params);
  return true;
}

// One shared poll: no canvas work while the tab is hidden; a screen repaints
// ONLY when its live params changed since the last draw (or on first layout /
// resize). Bypassed screens freeze after their single dimmed frame. Returns
// the number of canvases drawn (used by tests).
export function tickViz() {
  if (typeof document !== 'undefined' && document.hidden) return 0;
  let count = 0;
  entries = entries.filter((e) => {
    if (!e.canvas.isConnected) return false;
    if (e.frozen && e.drawn) return true; // bypassed: keep the frozen frame
    if (e.drawn) {
      const resized = e.canvas.clientWidth !== e.cw || e.canvas.clientHeight !== e.ch;
      if (!resized && liveSig(e) === e.sig) return true; // nothing moved — no work
    }
    const ok = drawEntry(e);
    if (ok === null) return false; // broken entry — drop it
    if (ok) { count++; e.drawn = true; }
    return true;
  });
  if (timer && entries.length === 0) { clearInterval(timer); timer = null; }
  return count;
}

// test / debug introspection
export function vizEntryCount() { return entries.length; }
