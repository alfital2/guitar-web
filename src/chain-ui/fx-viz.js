// src/chain-ui/fx-viz.js — live, param-driven pedal-screen visualizations.
//
// Every pedal's screen (the .pedal-plate lens area) shows a tiny honest diagram
// of what the effect does to sound, animated with the CURRENT knob settings.
// One shared ~12fps ticker (a single setInterval, no per-pedal rAF) iterates
// the registered canvases and calls the effect type's draw(g, t, params, w, h).
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

// Cache built curves by maker + amount so a 12fps redraw doesn't rebuild the
// Float32Array every frame. Values key the cache, so any knob move rebuilds.
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
// ---------------------------------------------------------------------------

// delay family: dry pulse + decaying echo bars. Spacing tracks Time, bar count
// and decay track Feedback; a travelling highlight replays the echo train.
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
    const hot = Math.floor(((t * 1.3) % 1) * bars.length);
    bars.forEach((b, i) => {
      const wob = flut ? Math.sin(t * (1.5 + flut * 0.9) + i * 1.9) * flut * 0.55 : 0;
      const hgt = b.amp * h * 0.5;
      const up = !(alternate && i % 2);
      g.fillStyle = hexA(c, (i === 0 ? 0.95 : 0.4 + 0.45 * b.amp) + (i === hot ? 0.2 : 0));
      if (up) g.fillRect(b.x - 1.5, base - hgt + wob, 3, hgt);
      else g.fillRect(b.x - 1.5, base + wob - h * 0.06, 3, hgt * 0.55);
    });
  };
}

// spectrum-hump family (wah / autowah): a bandpass peak on a baseline.
function humpViz(type, centerFn) {
  const c = col(type);
  return (g, t, p, w, h) => {
    const mid = h * 0.68;
    const cx = centerFn(p, t);                     // 0..1
    const q = (p.resonance ?? 8) / 20;             // 0..1
    const peak = h * (0.2 + 0.34 * q);
    const width = 0.05 + 0.22 * (1 - q);
    g.strokeStyle = hexA(c, 0.9); g.lineWidth = 1.8;
    plot(g, (u) => {
      const d = (u - cx) / width;
      return mid - peak * Math.exp(-d * d);
    }, 6, w - 6);
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
    const mid = h / 2, amp = h * 0.34, ph = t * 1.2;
    g.strokeStyle = hexA(c, 0.28); g.lineWidth = 1.2;
    plot(g, (u) => mid - Math.sin(TAU * (u * 2) + ph) * amp, 6, w - 6, 64);
    g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
    plot(g, (u) => mid - shape(curve, Math.sin(TAU * (u * 2) + ph)) * amp, 6, w - 6, 96);
  };
}

// pitch family: reference wave + shifted wave at the true frequency ratio.
function pitchWave(g, c, w, h, yC, cycles, alpha, t, ampScale = 1) {
  g.strokeStyle = hexA(c, alpha); g.lineWidth = 1.7;
  plot(g, (u) => yC - Math.sin(TAU * (u * cycles + t * 0.35)) * h * 0.13 * ampScale, 6, w - 6, 72);
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
    const shimmer = 0.75 + 0.25 * Math.sin(t * 2.2 + i * 2.6);
    g.fillStyle = hexA(c, (0.14 + 0.72 * mix) * env * shimmer + 0.06);
    const hgt = h * 0.42 * env;
    g.fillRect(x - 1, base - hgt, 2, hgt);
  }
};

VIZ.springverb = (g, t, p, w, h) => {
  const c = col('springverb');
  const mid = h * 0.52, coils = 11;
  const speed = 0.4 + ((p.tension ?? 5) / 10) * 1.6;
  const tail = 0.15 + ((p.decay ?? 5) / 10) * 0.5; // ripple trail length (0..1 of coil)
  const head = (t * speed) % 1;
  g.lineWidth = 1.7;
  g.beginPath();
  for (let i = 0; i <= coils * 8; i++) {
    const u = i / (coils * 8), x = 8 + (w - 16) * u;
    let d = head - u; if (d < 0) d += 1;
    const ring = d < tail ? (1 - d / tail) : 0;       // travelling chirp ripple
    const y = mid + Math.sin(u * TAU * coils) * (h * 0.1 + h * 0.16 * ring);
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.strokeStyle = hexA(c, 0.55 + 0.4 * (p.mix ?? 0.35));
  g.stroke();
};

VIZ.chorus = (g, t, p, w, h) => {
  const c = col('chorus');
  const mid = h / 2, rate = Math.min(p.rate ?? 1.5, 6) * 0.7, depth = (p.depth ?? 4) / 10;
  for (let k = 0; k < 3; k++) {
    const det = (k - 1) * depth * 0.5;
    const drift = Math.sin(t * rate + k * 2.1) * depth * 1.4;
    g.strokeStyle = hexA(c, k === 1 ? 0.95 : 0.25 + 0.55 * (p.mix ?? 0.4));
    g.lineWidth = k === 1 ? 1.8 : 1.3;
    plot(g, (u) => mid - Math.sin(TAU * (u * (2.4 + det * 0.4)) + t * rate * 0.8 + drift) * h * 0.27, 6, w - 6, 64);
  }
};

VIZ.flanger = (g, t, p, w, h) => {
  const c = col('flanger');
  const mid = h * 0.32, teeth = 5.5;
  const sweep = Math.sin(t * Math.min(p.rate ?? 0.4, 4) * TAU * 0.35) * TAU * 0.5;
  const depth = h * 0.42 * ((p.depth ?? 5) / 10);
  const sharp = 1 + (p.feedback ?? 0.5) * 3; // feedback sharpens the comb teeth
  g.strokeStyle = hexA(c, 0.92); g.lineWidth = 1.8;
  plot(g, (u) => {
    const comb = 0.5 + 0.5 * Math.cos(u * TAU * teeth + sweep);
    return mid + depth * Math.pow(comb, 1 / sharp);
  }, 6, w - 6, 96);
};

VIZ.phaser = (g, t, p, w, h) => {
  const c = col('phaser');
  const mid = h * 0.5, notches = 3;
  const depth = h * 0.3 * ((p.depth ?? 6) / 10);
  const drift = Math.sin(t * Math.min(p.rate ?? 0.5, 4) * TAU * 0.3) * 0.16;
  const centers = [];
  for (let k = 0; k < notches; k++) centers.push(0.22 + k * 0.28 + drift);
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
  const m = ((p.depth ?? 4) / 10) * 0.4 * Math.sin(t * Math.min(p.rate ?? 5, 6) * 1.1);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.9;
  plot(g, (u) => mid - Math.sin(TAU * u * 3 * (1 + m * u)) * h * 0.3, 6, w - 6, 96);
};

VIZ.tremolo = (g, t, p, w, h) => {
  const c = col('tremolo');
  const mid = h / 2, depth = p.depth ?? 0.6, square = (p.shape ?? 0) >= 0.5;
  const lfo = (x) => {
    const s = Math.sin(x);
    return square ? Math.sign(s) : s;
  };
  const env = (u) => 1 - depth * (0.5 + 0.5 * lfo(TAU * u * 1.6 - t * Math.min(p.rate ?? 5, 7) * 0.9));
  g.strokeStyle = hexA(c, 0.35); g.lineWidth = 1.1;
  plot(g, (u) => mid - env(u) * h * 0.34, 6, w - 6, 72);
  plot(g, (u) => mid + env(u) * h * 0.34, 6, w - 6, 72);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.6;
  plot(g, (u) => mid - Math.sin(TAU * u * 8) * env(u) * h * 0.34, 6, w - 6, 128);
};

VIZ.rotary = (g, t, p, w, h) => {
  const c = col('rotary');
  const cx = w / 2, cy = h / 2;
  const rx = w * 0.3, ry = h * 0.16 * (0.4 + 0.6 * ((p.depth ?? 6) / 10));
  const a = t * mapRange(p.speed ?? 6, 0, 10, 0.25, 3.6) * TAU * 0.5;
  g.strokeStyle = hexA(c, 0.35); g.lineWidth = 1.2;
  g.beginPath(); g.ellipse ? g.ellipse(cx, cy, rx, Math.max(ry, 1), 0, 0, TAU) : g.arc(cx, cy, rx, 0, TAU); g.stroke();
  const x1 = cx + Math.cos(a) * rx, y1 = cy + Math.sin(a) * ry;
  const x2 = cx - Math.cos(a) * rx, y2 = cy - Math.sin(a) * ry;
  g.strokeStyle = hexA(c, 0.85); g.lineWidth = 1.8;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  const front = Math.sin(a) > 0;
  g.fillStyle = hexA(c, front ? 0.95 : 0.5);
  g.beginPath(); g.arc(x1, y1, front ? 3.4 : 2.4, 0, TAU); g.fill();
  g.fillStyle = hexA(c, front ? 0.5 : 0.95);
  g.beginPath(); g.arc(x2, y2, front ? 2.4 : 3.4, 0, TAU); g.fill();
};

VIZ.autopan = (g, t, p, w, h) => {
  const c = col('autopan');
  const mid = h * 0.52, depth = p.depth ?? 0.8, square = (p.shape ?? 0) >= 0.5;
  const s = Math.sin(t * Math.min(p.rate ?? 2, 5) * 1.6);
  const x = w / 2 + (square ? Math.sign(s) : s) * (w * 0.3) * depth;
  // L / R speaker glyphs
  for (const [sx, dir] of [[10, 1], [w - 10, -1]]) {
    g.strokeStyle = hexA(c, 0.6); g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(sx, mid - 8); g.lineTo(sx + 5 * dir, mid - 3); g.lineTo(sx + 5 * dir, mid + 3); g.lineTo(sx, mid + 8);
    g.closePath(); g.stroke();
  }
  g.strokeStyle = hexA(c, 0.28); g.lineWidth = 1;
  g.beginPath(); g.moveTo(18, mid); g.lineTo(w - 18, mid); g.stroke();
  g.fillStyle = hexA(c, 0.95);
  g.beginPath(); g.arc(x, mid, 4, 0, TAU); g.fill();
};

VIZ.ringmod = (g, t, p, w, h) => {
  const c = col('ringmod');
  const mid = h / 2, mix = p.mix ?? 0.5;
  const n = mapRange(Math.log10(Math.max(p.freq ?? 220, 20)), Math.log10(20), Math.log10(2000), 3, 15);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.7;
  plot(g, (u) => {
    const carrier = Math.sin(TAU * (u * 2.2) + t);
    const prod = carrier * Math.sin(TAU * u * n + t * 2.4);
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
  const ph = t * 1.1;
  g.strokeStyle = hexA(c, 0.3); g.lineWidth = 1.2;
  plot(g, (u) => h * 0.3 - Math.sin(TAU * u * 2 + ph) * h * 0.16, 6, w - 6, 72);
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.8;
  plot(g, (u) => h * 0.68 - shape(clip, shape(curve, Math.sin(TAU * u * 2 + ph))) * h * 0.18, 6, w - 6, 96);
};

// compressor/limiter: the true gain-computer knee + a bouncing IN level dot.
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
    // animated input level + its compressed output
    const inDb = -44 + 40 * (0.5 + 0.5 * Math.sin(t * 1.7) * Math.sin(t * 0.61 + 1));
    const oDb = outDb(inDb);
    g.fillStyle = hexA(c, 0.95);
    g.beginPath(); g.arc(X(inDb), Y(oDb), 2.6, 0, TAU); g.fill();
    // IN / OUT meter bars at left
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
  // is chopped (drawn faint) — exactly what the gate does to the sound.
  const env = (u) => {
    const burst = Math.exp(-Math.pow((u - 0.3 - 0.1 * Math.sin(t * 0.7)) / 0.14, 2));
    const noise = 0.16 + 0.1 * Math.abs(Math.sin(u * 91 + t * 9) * Math.sin(u * 53 - t * 6));
    return Math.max(burst, noise);
  };
  const sig = (u) => env(u) * Math.sin(u * TAU * 9 + t * 3);
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
  g.strokeStyle = hexA(c, 0.92 + 0.06 * Math.sin(t * 2)); g.lineWidth = 1.9;
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
  const exc = 1 + 0.05 * Math.sin(t * 7) * (0.4 + 0.6 * ((p.presence ?? 5) / 10));
  const rings = [[1, 0.9], [0.62, 0.35 + 0.5 * ((p.brightness ?? 4) / 10)], [0.26, 0.8]];
  for (const [k, a] of rings) {
    g.strokeStyle = hexA(c, a); g.lineWidth = k === 1 ? 2 : 1.4;
    g.beginPath(); g.arc(cx, cy, base * k * (k === 1 ? 1 : exc), 0, TAU); g.stroke();
  }
  g.fillStyle = hexA(c, 0.9);
  g.beginPath(); g.arc(cx, cy, 2.2 * exc, 0, TAU); g.fill();
};

VIZ.wah = humpViz('wah', (p) => 0.12 + 0.76 * ((p.position ?? 5) / 10));
VIZ.autowah = humpViz('autowah', (p, t) => {
  const speed = 0.6 + ((p.sensitivity ?? 6) / 10) * 2;
  const span = 0.1 + 0.35 * ((p.range ?? 5) / 10);
  return 0.5 + Math.sin(t * speed) * span;
});

VIZ.boost = (g, t, p, w, h) => {
  const c = col('boost');
  const mid = h * 0.55, gain = (p.gain ?? 6) / 24;
  const amp = h * (0.1 + 0.32 * gain) * (1 + 0.03 * Math.sin(t * 3));
  g.strokeStyle = hexA(c, 0.95); g.lineWidth = 1.8;
  plot(g, (u) => mid - Math.sin(TAU * (u * 2.4) + t) * amp, 6, w * 0.7, 72);
  // level arrow, length tracks gain
  const ax = w * 0.84, ay0 = mid + h * 0.16, ay1 = ay0 - h * (0.14 + 0.42 * gain);
  g.strokeStyle = hexA(c, 0.9); g.lineWidth = 2;
  g.beginPath(); g.moveTo(ax, ay0); g.lineTo(ax, ay1); g.stroke();
  g.beginPath(); g.moveTo(ax - 4, ay1 + 6); g.lineTo(ax, ay1); g.lineTo(ax + 4, ay1 + 6); g.stroke();
};

VIZ.widener = (g, t, p, w, h) => {
  const c = col('widener');
  const cx = w / 2, top = h * 0.2, bot = h * 0.84;
  const spread = mapRange(p.width ?? 5, 0, 10, 2, w * 0.32) * (1 + 0.05 * Math.sin(t * 1.4));
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
  pitchWave(g, c, w, h, h * 0.3, 2.2, 0.4, t);
  pitchWave(g, c, w, h, h * 0.68, 2.2 * ratio, 0.5 + 0.45 * (p.mix ?? 0.6), t);
};

VIZ.harmonizer = (g, t, p, w, h) => {
  const c = col('harmonizer');
  const st = p.interval ?? 7, ratio = Math.pow(2, st / 12);
  pitchWave(g, c, w, h, h * 0.3, 2.2, 0.9, t);
  pitchWave(g, c, w, h, h * 0.68, 2.2 * ratio, 0.25 + 0.7 * (p.mix ?? 0.5), t);
};

VIZ.whammy = (g, t, p, w, h) => {
  const c = col('whammy');
  const bend = (p.bend ?? 10) / 10, range = p.range ?? 12;
  const glide = 0.5 + 0.5 * Math.sin(t * 1.3);             // the treadle ride
  const ratio = Math.pow(2, (range * bend * glide) / 12);
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
  const a0 = -Math.PI / 2, prog = (t * 0.35) % 1;
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
  g.strokeStyle = hexA(c, 0.5 + 0.1 * Math.sin(t * 2)); g.lineWidth = 1.3;
  g.beginPath(); g.arc(w * 0.24, mid - body * h * 0.42 - 7, 3.2, 0, TAU); g.stroke();
};

VIZ.univibe = (g, t, p, w, h) => {
  const c = col('univibe');
  const mid = h / 2;
  const speed = Math.min(p.speed ?? 3, 6) * 1.1, depth = ((p.intensity ?? 6) / 10);
  g.strokeStyle = hexA(c, 0.85); g.lineWidth = 1.7;
  plot(g, (u) => mid - Math.sin(TAU * u * 2.4 + t * speed * 0.5) * h * 0.2 * (1 - 0.4 * depth * (0.5 + 0.5 * Math.sin(t * speed))), 6, w - 6, 72);
  // 4 staggered all-pass stages throbbing in sequence
  for (let k = 0; k < 4; k++) {
    const u = 0.2 + k * 0.2;
    const throb = 0.5 + 0.5 * Math.sin(t * speed - k * (Math.PI / 2));
    g.fillStyle = hexA(c, 0.25 + 0.7 * throb * (0.3 + 0.7 * depth) * (0.3 + 0.7 * (p.mix ?? 0.5)));
    g.beginPath(); g.arc(6 + (w - 12) * u, h * 0.82, 2.6 + 1.6 * throb * depth, 0, TAU); g.fill();
  }
};

// ---------------------------------------------------------------------------
// registration + the single shared ticker
// ---------------------------------------------------------------------------
const FRAME_MS = 83; // ~12 fps
let entries = [];
let timer = null;
const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());

function now() { return ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) / 1000; }

function reducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

// Register a pedal-screen canvas. getParams() must return the LIVE params
// object for the unit (read from the chain model at each tick, so knob turns
// show on the next frame with no extra wiring). Returns false when the type
// has no viz (caller falls back to the static motif).
export function registerViz(canvas, type, getParams, opts = {}) {
  if (typeof VIZ[type] !== 'function') return false;
  entries.push({
    canvas, type, getParams, g: null,
    static: !!opts.bypassed || reducedMotion(),
    drawn: false,
  });
  if (!timer && typeof setInterval === 'function') timer = setInterval(tickViz, FRAME_MS);
  return true;
}

// Drop every registered canvas (the board re-renders often; the renderer calls
// this before each rebuild so dead canvases never accumulate).
export function resetViz() {
  entries = [];
  if (timer) { clearInterval(timer); timer = null; }
}

function drawEntry(e, t) {
  const c = e.canvas;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (!cw || !ch) return false; // not laid out yet — try next tick
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
  try { VIZ[e.type](g, t, params, cw, ch); } catch { return null; }
  return true;
}

// One shared tick: no canvas work at all while the tab is hidden; bypassed /
// reduced-motion entries freeze after their single static frame. Returns the
// number of canvases drawn (used by tests).
export function tickViz(t = now()) {
  if (typeof document !== 'undefined' && document.hidden) return 0;
  let count = 0;
  let live = 0;
  entries = entries.filter((e) => {
    if (!e.canvas.isConnected) return false;
    if (e.static && e.drawn) return true; // frozen frame stays, no redraw
    const ok = drawEntry(e, e.static ? 0 : t);
    if (ok === null) return false; // broken entry — drop it
    if (ok) { count++; if (e.static) e.drawn = true; }
    if (!e.static || !e.drawn) live++;
    return true;
  });
  if (timer && (entries.length === 0 || live === 0)) { clearInterval(timer); timer = null; }
  return count;
}

// test / debug introspection
export function vizEntryCount() { return entries.length; }
