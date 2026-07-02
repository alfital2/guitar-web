// src/chain-ui/fx-art.js
// Bespoke per-pedal faceplate art. Each effect is its own product: unique body
// color, texture, trim and a baked-in stylized wordmark — no shared template.
// Pedal WIDTH scales with knob count (like GarageBand) so the art holds exactly
// the right number of controls; height is fixed at 248. Pure inline SVG, injected
// once as a hidden <symbol> sprite. Controls overlay on top in the DOM.

// ── Pedal typography system ────────────────────────────────────────────────
// The pedal NAME is the branding element: one personality font per effect
// (grouped by sonic family, differentiated per-pedal via size / tracking / skew)
// carried at 10–17px. Knob labels are NOT here — they use one clean condensed
// sans everywhere (Barlow Condensed, in CSS). `dir` is the ink direction the
// wordmark needs against the faceplate's shaded lower band: 'light' = light ink
// (dark bodies), 'dark' = dark ink (bright bodies). Fields:
//   font  personality family (must be in the single <link> font budget)
//   w     font-weight        size  px (10–17)     ls  letter-spacing
//   tr    'up' uppercase | 'none' keep case (script faces read better mixed)
//   skew  degrees of skewX (jet/metal lean)       dir 'light' | 'dark'
export const FX_TYPE = {
  // Industrial / dynamics — Oswald, machined with wide tracking.
  compressor: { font: "'Oswald', sans-serif",   w: 600, size: 13, ls: '.12em', tr: 'up', skew: 0, dir: 'light' },
  boost:      { font: "'Oswald', sans-serif",   w: 700, size: 16, ls: '.16em', tr: 'up', skew: 0, dir: 'light' },
  gate:       { font: "'Oswald', sans-serif",   w: 600, size: 12, ls: '.10em', tr: 'up', skew: 0, dir: 'light' },
  limiter:    { font: "'Oswald', sans-serif",   w: 600, size: 14, ls: '.14em', tr: 'up', skew: 0, dir: 'light' },
  // Vintage / tape — Oswald, lighter weight + very wide tracking (silkscreen).
  'tape-echo':{ font: "'Oswald', sans-serif",   w: 500, size: 12, ls: '.16em', tr: 'up', skew: 0, dir: 'light' },
  tremolo:    { font: "'Oswald', sans-serif",   w: 500, size: 14, ls: '.14em', tr: 'up', skew: 0, dir: 'dark'  },
  // Retro-digital / time + pitch — Audiowide.
  delay:      { font: "'Audiowide', sans-serif", w: 400, size: 14, ls: '.02em', tr: 'up', skew: 0, dir: 'dark'  },
  pingpong:   { font: "'Audiowide', sans-serif", w: 400, size: 11, ls: '0',     tr: 'up', skew: 0, dir: 'dark'  },
  looper:     { font: "'Audiowide', sans-serif", w: 400, size: 13, ls: '.02em', tr: 'up', skew: 0, dir: 'light' },
  pitchshift: { font: "'Audiowide', sans-serif", w: 400, size: 10, ls: '0',     tr: 'up', skew: 0, dir: 'light' },
  harmonizer: { font: "'Audiowide', sans-serif", w: 400, size: 11, ls: '0',     tr: 'up', skew: 0, dir: 'light' },
  whammy:     { font: "'Audiowide', sans-serif", w: 400, size: 13, ls: '.02em', tr: 'up', skew: 0, dir: 'light' },
  // Psych / organic — Righteous, rounded retro.
  fuzz:       { font: "'Righteous', sans-serif", w: 400, size: 17, ls: '.03em', tr: 'up', skew: 0, dir: 'light' },
  univibe:    { font: "'Righteous', sans-serif", w: 400, size: 12, ls: '.02em', tr: 'up', skew: 0, dir: 'light' },
  octave:     { font: "'Righteous', sans-serif", w: 400, size: 12, ls: '.02em', tr: 'up', skew: 0, dir: 'light' },
  acousticsim:{ font: "'Righteous', sans-serif", w: 400, size: 11, ls: '.01em', tr: 'up', skew: 0, dir: 'light' },
  // Metal + jet / sweep — Anton, ultra-condensed heavy, leaning.
  distortion: { font: "'Anton', sans-serif",     w: 400, size: 15, ls: '.01em', tr: 'up', skew: -3, dir: 'light' },
  flanger:    { font: "'Anton', sans-serif",     w: 400, size: 15, ls: '.02em', tr: 'up', skew: -9, dir: 'light' },
  phaser:     { font: "'Anton', sans-serif",     w: 400, size: 16, ls: '.02em', tr: 'up', skew: -9, dir: 'light' },
  // Funk / filter — Bungee, chunky.
  wah:        { font: "'Bungee', sans-serif",    w: 400, size: 15, ls: '.01em', tr: 'up', skew: 0, dir: 'dark'  },
  autowah:    { font: "'Bungee', sans-serif",    w: 400, size: 10, ls: '0',     tr: 'up', skew: 0, dir: 'dark'  },
  // Space / spin — Orbitron.
  rotary:     { font: "'Orbitron', sans-serif",  w: 800, size: 13, ls: '.06em', tr: 'up', skew: 0, dir: 'light' },
  autopan:    { font: "'Orbitron', sans-serif",  w: 600, size: 11, ls: '.04em', tr: 'up', skew: 0, dir: 'light' },
  ringmod:    { font: "'Orbitron', sans-serif",  w: 600, size: 10, ls: '.05em', tr: 'up', skew: 0, dir: 'light' },
  widener:    { font: "'Orbitron', sans-serif",  w: 600, size: 12, ls: '.05em', tr: 'up', skew: 0, dir: 'light' },
  reverb:     { font: "'Orbitron', sans-serif",  w: 800, size: 13, ls: '.08em', tr: 'up', skew: 0, dir: 'light' },
  // Script / surf — Pacifico, flowing (kept mixed-case — script uppercases badly).
  chorus:     { font: "'Pacifico', cursive",     w: 400, size: 17, ls: '0',     tr: 'none', skew: 0, dir: 'dark' },
  vibrato:    { font: "'Pacifico', cursive",     w: 400, size: 16, ls: '0',     tr: 'none', skew: 0, dir: 'dark' },
  springverb: { font: "'Pacifico', cursive",     w: 400, size: 12, ls: '0',     tr: 'none', skew: 0, dir: 'dark' },
};

// Legacy shape used by the SVG faceplate sheet + palette-modal tiles.
export const FX_FONTS = Object.fromEntries(
  Object.entries(FX_TYPE).map(([k, v]) => [k, { family: v.font, ls: v.ls }]),
);

export const FX_COLORS = {
  compressor: '#8fa3b0', boost: '#2e9bff', gate: '#e9c93a', fuzz: '#e0a943', octave: '#d4a017',
  wah: '#ff5a4d', autowah: '#ff9f1c', chorus: '#5aa6d8', flanger: '#b08bff', phaser: '#ff4fd8',
  tremolo: '#e8c07a', vibrato: '#ffa64d', autopan: '#ffcf5a', rotary: '#caa06a', ringmod: '#e8b84b',
  delay: '#39d98a', 'tape-echo': '#7fd8c6', pingpong: '#ff8a3d', reverb: '#8f7dff', widener: '#39d3ff',
  limiter: '#9aa6ad', pitchshift: '#33e0c8', looper: '#39d98a',
  acousticsim: '#c98a4a', distortion: '#ff7a1a', harmonizer: '#4a7dff',
  univibe: '#6fa8ff', springverb: '#49c9a4', whammy: '#ff3b30',
};

// Pedal BODY color as rendered on the board (the `--c` behind every pedal).
// This is the single source of truth the pedalboard imports, and what the
// typography contrast test measures ink against. (Includes the amp-head module
// colors so the board can key everything off one map.)
export const FX_BODY = {
  compressor: '#0a84ff', drive: '#ff9f0a', eq: '#bf5af2', cabinet: '#32d74b',
  delay: '#ffd60a', reverb: '#ff375f', chorus: '#5ac8fa', boost: '#ff9500',
  fuzz: '#ff453a', octave: '#ff6482', tremolo: '#64d2ff', vibrato: '#40c8e0',
  flanger: '#7d7aff', phaser: '#bf5af2', ringmod: '#ac8e68', autowah: '#30d158',
  gate: '#8e8e93', wah: '#ffd60a', 'tape-echo': '#d4a017', pingpong: '#ffc857',
  widener: '#5e5ce6', limiter: '#0a84ff', pitchshift: '#ff2d55', looper: '#34c759',
  autopan: '#00c7be', rotary: '#a2845e', acousticsim: '#c98a4a', distortion: '#ff7a1a',
  harmonizer: '#4a7dff', univibe: '#6fa8ff', springverb: '#49c9a4', whammy: '#ff3b30',
};

// ── WCAG contrast helpers + engraved-ink presentation ──────────────────────
export const INK_LIGHT = '#fff6e8';   // warm near-white — used on dark bodies
export const INK_DARK = '#160d04';    // warm near-black — used on bright bodies
const _srgb = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const _rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const _hex = (a) => '#' + a.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
export function relLuminance(hex) {
  const [r, g, b] = _rgb(hex);
  return 0.2126 * _srgb(r) + 0.7152 * _srgb(g) + 0.0722 * _srgb(b);
}
export function contrastRatio(a, b) {
  const L1 = relLuminance(a), L2 = relLuminance(b);
  const hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
export function nameInk(type) { return (FX_TYPE[type]?.dir === 'dark') ? INK_DARK : INK_LIGHT; }
// The wordmark renders ~0.68 down the faceplate's vertical gradient (the shaded
// lower band) with a soft ink-well scrim behind it. This returns the effective
// pixel color behind the glyphs, so contrast is checked against what the eye
// actually sees — not the flat identity color.
export function nameSurface(type) {
  const body = FX_BODY[type]; if (!body) return '#000000';
  const dir = FX_TYPE[type]?.dir || 'light';
  const F = 0.68, A = 0.30; // gradient shade × ink-well scrim opacity
  const band = _rgb(body).map((v) => v * F);
  const scrim = dir === 'light' ? [0, 0, 0] : [255, 255, 255];
  return _hex(band.map((v, i) => v * (1 - A) + scrim[i] * A));
}
const _DIRSTYLE = {
  light: {
    shadow: '0 1px 0 rgba(0,0,0,.55), 0 2px 4px rgba(0,0,0,.5)',
    scrim: 'radial-gradient(closest-side, rgba(0,0,0,.58), rgba(0,0,0,0))',
    halo: '0 0 2px rgba(0,0,0,.82), 0 1px 1px rgba(0,0,0,.7)',
  },
  dark: {
    shadow: '0 1px 0 rgba(255,255,255,.55), 0 -1px 1px rgba(0,0,0,.22)',
    scrim: 'radial-gradient(closest-side, rgba(255,255,255,.52), rgba(255,255,255,0))',
    halo: '0 0 2px rgba(255,255,255,.7), 0 1px 0 rgba(255,255,255,.6)',
  },
};
// CSS custom-property bundle for a pedal: name font/treatment/ink + the shared
// condensed knob-label ink. Applied by the pedalboard onto the `.pedal` element.
export function pedalTypographyVars(type) {
  const t = FX_TYPE[type] || FX_TYPE.delay;
  const ds = _DIRSTYLE[t.dir] || _DIRSTYLE.light;
  const ink = t.dir === 'dark' ? INK_DARK : INK_LIGHT;
  return {
    '--name-font': t.font,
    '--name-weight': String(t.w),
    '--name-size': `${t.size}px`,
    '--name-ls': t.ls,
    '--name-transform': t.tr === 'none' ? 'none' : 'uppercase',
    '--name-skew': `${t.skew || 0}deg`,
    '--name-ink': ink,
    '--name-shadow': ds.shadow,
    '--name-scrim': ds.scrim,
    '--label-ink': ink,
    '--label-halo': ds.halo,
  };
}

// Knob count per effect (from the effect schemas) → drives pedal width.
export const FX_KNOBS = {
  compressor: 5, boost: 3, gate: 2, fuzz: 3, octave: 4, wah: 3, autowah: 4,
  chorus: 3, flanger: 4, phaser: 4, tremolo: 3, vibrato: 2, autopan: 3, rotary: 3, ringmod: 2,
  delay: 4, 'tape-echo': 5, pingpong: 4, reverb: 2, widener: 1,
  limiter: 2, pitchshift: 2, looper: 2,
  acousticsim: 3, distortion: 3, harmonizer: 3, univibe: 3, springverb: 3, whammy: 3,
};
// Per-effect motif: inline SVG (viewBox 0 0 102 80), stroke = currentColor,
// `.fill` elements paint solid. Used by the CSS pedal recreation.
export const FX_MOTIFS = {
  compressor: `<path stroke-width="5" fill="none" d="M12 54 A42 42 0 0 1 90 54"/><line stroke-width="4" x1="51" y1="54" x2="74" y2="20"/><circle class="fill" cx="51" cy="54" r="4"/>`,
  boost: `<path class="fill" d="M51 8 L78 42 H63 V60 H39 V42 H24 Z"/>`,
  gate: `<path stroke-width="5" fill="none" d="M10 42 q9 -20 18 0 t18 0 M56 42 H92"/><line stroke-width="3" stroke-dasharray="4 5" x1="52" y1="22" x2="52" y2="60"/>`,
  fuzz: `<path stroke-width="8" fill="none" stroke-linejoin="miter" d="M8 46 H26 V22 H45 V62 H63 V22 H82 V46 H94"/>`,
  octave: `<path stroke-width="4" fill="none" d="M51 6 L90 40 L51 74 L12 40 Z"/><path stroke-width="4" fill="none" d="M51 24 L72 40 L51 56 L30 40 Z"/>`,
  wah: `<g stroke-width="4" fill="none"><path d="M14 20 L88 12 M14 32 L88 24 M14 44 L88 36"/></g><path class="fill" d="M20 60 L80 34 L80 46 L28 68 Z"/>`,
  autowah: `<path stroke-width="6" fill="none" d="M12 58 Q51 6 90 58"/>`,
  chorus: `<g stroke-width="4" fill="none"><path d="M8 26 q11 -11 22 0 t22 0 t22 0 t22 0"/><path d="M8 40 q11 -11 22 0 t22 0 t22 0 t22 0"/><path d="M8 54 q11 -11 22 0 t22 0 t22 0 t22 0"/></g>`,
  flanger: `<g stroke-width="4" fill="none"><path d="M22 8 Q52 40 22 72"/><path d="M36 8 Q66 40 36 72"/><path d="M50 8 Q80 40 50 72"/></g>`,
  phaser: `<g stroke-width="4" fill="none"><circle cx="51" cy="40" r="11"/><circle cx="51" cy="40" r="24"/><path d="M12 50 C34 50 34 30 51 30 C68 30 68 50 90 50"/></g>`,
  tremolo: `<g class="fill"><rect x="16" y="34" width="7" height="14" rx="2"/><rect x="30" y="24" width="7" height="34" rx="2"/><rect x="44" y="16" width="7" height="50" rx="2"/><rect x="58" y="24" width="7" height="34" rx="2"/><rect x="72" y="34" width="7" height="14" rx="2"/></g>`,
  vibrato: `<path stroke-width="6" fill="none" d="M8 40 q8 -18 16 0 t16 0 t16 0 t16 0 t16 0"/>`,
  autopan: `<path stroke-width="5" fill="none" d="M14 46 Q51 6 88 46"/><circle class="fill" cx="14" cy="46" r="5"/><circle class="fill" cx="88" cy="46" r="5"/>`,
  rotary: `<circle stroke-width="4" fill="none" cx="51" cy="40" r="22"/><g stroke-width="4"><line x1="51" y1="40" x2="51" y2="18"/><line x1="51" y1="40" x2="70" y2="51"/><line x1="51" y1="40" x2="32" y2="51"/></g><circle class="fill" cx="51" cy="40" r="5"/>`,
  ringmod: `<circle class="fill" cx="51" cy="40" r="6"/><g stroke-width="3" fill="none"><ellipse cx="51" cy="40" rx="34" ry="13"/><ellipse cx="51" cy="40" rx="34" ry="13" transform="rotate(60 51 40)"/><ellipse cx="51" cy="40" rx="34" ry="13" transform="rotate(-60 51 40)"/></g>`,
  delay: `<g class="fill"><rect x="18" y="20" width="8" height="42" rx="2"/><rect x="36" y="26" width="8" height="36" rx="2" opacity=".75"/><rect x="54" y="34" width="8" height="28" rx="2" opacity=".5"/><rect x="72" y="42" width="8" height="20" rx="2" opacity=".3"/></g>`,
  'tape-echo': `<g stroke-width="4" fill="none"><circle cx="33" cy="40" r="17"/><circle cx="69" cy="40" r="17"/></g><circle class="fill" cx="33" cy="40" r="4"/><circle class="fill" cx="69" cy="40" r="4"/>`,
  pingpong: `<path stroke-width="5" fill="none" d="M14 14 L51 54 L88 14"/><circle class="fill" cx="14" cy="14" r="5"/><circle class="fill" cx="88" cy="14" r="5"/>`,
  reverb: `<g stroke-width="4" fill="none"><path d="M31 52 A22 22 0 0 1 71 52"/><path d="M20 52 A34 34 0 0 1 82 52"/><path d="M42 52 A11 11 0 0 1 60 52"/></g>`,
  widener: `<g stroke-width="5" fill="none"><path d="M44 40 H14 M23 31 L14 40 L23 49"/><path d="M58 40 H88 M79 31 L88 40 L79 49"/></g>`,
  limiter: `<line stroke-width="4" x1="10" y1="20" x2="92" y2="20"/><path stroke-width="5" fill="none" d="M10 54 q11 -30 22 0 t22 0 t22 0 t22 0"/>`,
  pitchshift: `<g stroke-width="5" fill="none"><path d="M34 46 V16 M26 24 L34 16 L42 24"/><path d="M68 22 V52 M60 44 L68 52 L76 44"/></g>`,
  looper: `<path stroke-width="5" fill="none" d="M30 50 A24 24 0 1 1 55 58"/><path class="fill" d="M50 46 L60 60 L44 62 Z"/>`,
  // Acoustic sim: soundhole + rosette rings with strings running across.
  acousticsim: `<circle stroke-width="4" fill="none" cx="51" cy="42" r="15"/><circle stroke-width="2" fill="none" cx="51" cy="42" r="21"/><g stroke-width="2"><line x1="8" y1="34" x2="94" y2="34"/><line x1="8" y1="42" x2="94" y2="42"/><line x1="8" y1="50" x2="94" y2="50"/></g>`,
  // Distortion: hard-clipped lightning bolt.
  distortion: `<path class="fill" d="M58 6 L28 44 H46 L38 74 L74 32 H54 Z"/>`,
  // Harmonizer: a note plus its ghost voice a fifth up.
  harmonizer: `<g stroke-width="4" fill="none"><path d="M32 58 V24 L48 20 V54"/></g><ellipse class="fill" cx="27" cy="58" rx="6" ry="4.5"/><ellipse class="fill" cx="43" cy="54" rx="6" ry="4.5"/><g opacity=".55"><path stroke-width="4" fill="none" d="M64 44 V12 L80 8 V40"/><ellipse class="fill" cx="59" cy="44" rx="6" ry="4.5"/><ellipse class="fill" cx="75" cy="40" rx="6" ry="4.5"/></g>`,
  // Uni-Vibe: one wave, four staggered photocell dots riding it.
  univibe: `<path stroke-width="4" fill="none" d="M8 44 q11 -20 22 0 t22 0 t22 0 t22 0"/><g class="fill"><circle cx="19" cy="34" r="4.5"/><circle cx="41" cy="52" r="4.5"/><circle cx="63" cy="34" r="4.5"/><circle cx="85" cy="52" r="4.5"/></g><circle stroke-width="2" fill="none" cx="51" cy="18" r="6"/>`,
  // Spring reverb: a coil spring stretched between two anchors.
  springverb: `<circle class="fill" cx="12" cy="40" r="4"/><circle class="fill" cx="90" cy="40" r="4"/><path stroke-width="4" fill="none" d="M12 40 H20 L28 26 L36 54 L44 26 L52 54 L60 26 L68 54 L76 26 L82 40 H90"/>`,
  // Whammy: pitch soaring up along a treadle sweep.
  whammy: `<path stroke-width="5" fill="none" d="M12 62 Q51 62 74 28"/><path class="fill" d="M84 12 L80 34 L64 22 Z"/><g stroke-width="3"><line x1="16" y1="70" x2="52" y2="70"/></g>`,
};

const WIDTHS = { 1: 108, 2: 128, 3: 152, 4: 190, 5: 228 };
const HEIGHT = 248;
export const fxWidth = (type) => WIDTHS[FX_KNOBS[type] ?? 3] ?? 152;

// Per-pedal knob styling — cap gradient, arc accent, pointer color, shape.
const DARK = ['#58585f', '#2a2a2f', '#0f0f12'];
const CHROME = ['#f2f4f6', '#aeb4ba', '#5d646b'];
const CREAM = ['#f6ecd2', '#e7c79a', '#b98a3a'];
const BLACK = ['#3a3a40', '#1a1a1e', '#08080a'];
export const FX_KNOB_STYLE = {
  compressor: { cap: CHROME, accent: '#2e9bff', pointer: '#222' },
  boost: { cap: BLACK, accent: '#6db3ff', pointer: '#fff' },
  gate: { cap: BLACK, accent: '#e9c93a', pointer: '#1a1a1a' },
  fuzz: { cap: CREAM, accent: '#d97a1f', pointer: '#5e360c', shape: 'chicken' },
  octave: { cap: CREAM, accent: '#e8c878', pointer: '#5e360c', shape: 'chicken' },
  wah: { cap: CHROME, accent: '#ff5a4d', pointer: '#222' },
  autowah: { cap: CREAM, accent: '#2f9e44', pointer: '#5e360c' },
  chorus: { cap: CHROME, accent: '#3f86c4', pointer: '#16364f' },
  flanger: { cap: BLACK, accent: '#c9b6ff', pointer: '#fff' },
  phaser: { cap: BLACK, accent: '#ffe3f7', pointer: '#fff' },
  tremolo: { cap: CREAM, accent: '#e8c07a', pointer: '#5e360c', shape: 'chicken' },
  vibrato: { cap: CREAM, accent: '#ffae57', pointer: '#5e360c', shape: 'chicken' },
  rotary: { cap: CREAM, accent: '#ffe6c4', pointer: '#5e360c', shape: 'chicken' },
  autopan: { cap: CREAM, accent: '#ff7eb0', pointer: '#5e360c' },
  delay: { cap: BLACK, accent: '#39d98a', pointer: '#fff' },
  'tape-echo': { cap: CHROME, accent: '#7fd8c6', pointer: '#222', shape: 'chicken' },
  pingpong: { cap: BLACK, accent: '#ff8a3d', pointer: '#fff' },
  reverb: { cap: BLACK, accent: '#b9aaff', pointer: '#fff' },
  widener: { cap: BLACK, accent: '#39d3ff', pointer: '#fff' },
  limiter: { cap: CHROME, accent: '#d6b3aa', pointer: '#222' },
  pitchshift: { cap: BLACK, accent: '#33e0c8', pointer: '#fff' },
  looper: { cap: BLACK, accent: '#8af0b8', pointer: '#fff' },
  ringmod: { cap: BLACK, accent: '#ffe18a', pointer: '#fff' },
  acousticsim: { cap: CREAM, accent: '#8a5a24', pointer: '#5e360c' },
  distortion: { cap: BLACK, accent: '#ff7a1a', pointer: '#fff' },
  harmonizer: { cap: BLACK, accent: '#9db9ff', pointer: '#fff' },
  univibe: { cap: CREAM, accent: '#6fa8ff', pointer: '#2a3a5e', shape: 'chicken' },
  springverb: { cap: CHROME, accent: '#49c9a4', pointer: '#222' },
  whammy: { cap: BLACK, accent: '#ff6b62', pointer: '#fff' },
};

// Per-pedal knob positions {x, y[, r]} in art coords (0..width, 0..248),
// matching the param order. Lets each faceplate place its controls distinctly
// (rows, 2x2 grids, a single feature knob) instead of one uniform band.
const row = (cx, y, n, gap = 44, r) => Array.from({ length: n }, (_, i) => ({ x: +(cx + (i - (n - 1) / 2) * gap).toFixed(1), y, r }));
export const FX_KNOB_LAYOUT = {
  compressor: row(114, 138, 5, 44, 34),
  boost: row(76, 120, 3, 38),
  gate: row(64, 124, 2, 44),
  fuzz: [{ x: 40, y: 132, r: 32 }, { x: 76, y: 128, r: 46 }, { x: 112, y: 132, r: 32 }],
  octave: [{ x: 70, y: 82, r: 30 }, { x: 120, y: 82, r: 30 }, { x: 70, y: 126, r: 30 }, { x: 120, y: 126, r: 30 }],
  wah: row(76, 126, 3, 38),
  autowah: row(95, 124, 4, 41),
  chorus: row(76, 128, 3, 38),
  flanger: row(95, 128, 4, 41),
  phaser: row(95, 130, 4, 41),
  tremolo: row(76, 130, 3, 38),
  vibrato: row(64, 128, 2, 46),
  rotary: row(76, 134, 3, 38),
  autopan: row(76, 118, 3, 38),
  delay: row(95, 134, 4, 41),
  'tape-echo': row(114, 132, 5, 44, 34),
  pingpong: row(95, 128, 4, 41),
  reverb: row(64, 130, 2, 46),
  widener: [{ x: 54, y: 120, r: 40 }],
  limiter: row(64, 128, 2, 46),
  pitchshift: row(64, 150, 2, 46),
  looper: row(64, 128, 2, 46),
  ringmod: row(64, 128, 2, 46),
  acousticsim: row(76, 128, 3, 38),
  distortion: row(76, 130, 3, 38),
  harmonizer: row(76, 132, 3, 38),
  univibe: [{ x: 76, y: 122, r: 44 }, { x: 42, y: 168, r: 28 }, { x: 110, y: 168, r: 28 }],
  springverb: row(76, 128, 3, 38),
  whammy: row(76, 130, 3, 38),
};

// ---- shared texture filters (neutral: alpha from noise; tints any solid rect) --
const FILTERS = `
  <filter id="nz-fine"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>
  <filter id="nz-brushV"><feTurbulence type="fractalNoise" baseFrequency=".96 .014" numOctaves="2"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>
  <filter id="nz-brushH"><feTurbulence type="fractalNoise" baseFrequency=".014 .96" numOctaves="2"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>
  <filter id="nz-cloud"><feTurbulence type="fractalNoise" baseFrequency=".02 .032" numOctaves="4" seed="7" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.1 0 0 0 -.35"/><feComposite operator="in" in2="SourceGraphic"/></filter>
  <filter id="nz-streak"><feTurbulence type="fractalNoise" baseFrequency=".028 .26" numOctaves="3" seed="4"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>
  <filter id="nz-fur"><feTurbulence type="fractalNoise" baseFrequency=".06 .9" numOctaves="3" seed="2"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0"/><feComposite operator="in" in2="SourceGraphic"/></filter>`;

// ---- width-aware shell helpers --------------------------------------------
const bevel = (w) => `
  <rect x="2" y="2" width="${w - 4}" height="244" rx="14" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.5"/>
  <rect x="3" y="3.5" width="${w - 6}" height="242" rx="13" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="1"/>`;
const screws = (w, c = 'rgba(0,0,0,.45)') =>
  `<g fill="${c}"><circle cx="16" cy="16" r="4"/><circle cx="${w - 16}" cy="16" r="4"/><circle cx="16" cy="232" r="4"/><circle cx="${w - 16}" cy="232" r="4"/></g>
   <g fill="#fff" fill-opacity=".25"><circle cx="15" cy="15" r="1.2"/><circle cx="${w - 17}" cy="15" r="1.2"/><circle cx="15" cy="231" r="1.2"/><circle cx="${w - 17}" cy="231" r="1.2"/></g>`;
const texW = (w, fill, filter, op) => `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="${fill}" filter="url(#${filter})" opacity="${op}"/>`;
const wm = (cx, font, t, size, dark, light, y, ls = 0) => `
  <text x="${cx}" y="${y + 2}" text-anchor="middle" font-family="${font}" font-size="${size}" fill="${dark}" letter-spacing="${ls}">${t}</text>
  <text x="${cx}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${size}" fill="${light}" letter-spacing="${ls}">${t}</text>`;
const tag = (cx, t, color, y, ls = 2) =>
  `<text x="${cx}" y="${y}" text-anchor="middle" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="700" font-size="7.5" fill="${color}" letter-spacing="${ls}">${t}</text>`;

// Build a symbol. `o.bg`/`o.fg` receive (w, cx). `o.motif` is authored centered
// on x=88 (reused across widths) and auto-recentred to cx.
function plate(id, o) {
  const w = fxWidth(id), cx = w / 2;
  const shift = (cx - 88).toFixed(1);
  const font = (FX_FONTS[id] || {}).family || 'sans-serif';
  return `<symbol id="fx-art-${id}" viewBox="0 0 ${w} ${HEIGHT}" preserveAspectRatio="xMidYMid meet">`
    + `${o.defs || ''}`
    + `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="${o.body}"/>`
    + `${o.bg ? o.bg(w, cx) : ''}`
    + (o.motif ? `<g transform="translate(${shift},0)">${o.motif}</g>` : '')
    + `${o.fg ? o.fg(w, cx) : ''}`
    + `${o.word(cx, font)}`
    + `${o.grain ? texW(w, '#000', 'nz-fine', o.grain) : ''}`
    + bevel(w) + screws(w, o.screw)
    + `</symbol>`;
}

// ===========================================================================
// Premium "glass hardware" rebuild (prototype for the faceplate overhaul):
// die-cast metal enclosure with a cylindrical anodized gradient, a recessed
// enamel faceplate panel for depth, a diagonal glass reflection and a top gloss.
const FUZZ = plate('fuzz', {
  defs: `
    <linearGradient id="fz-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f9dca0"/><stop offset=".16" stop-color="#e7b662"/>
      <stop offset=".5" stop-color="#c98a34"/><stop offset=".82" stop-color="#875420"/>
      <stop offset="1" stop-color="#563310"/></linearGradient>
    <linearGradient id="fz-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".12" stop-color="#fff" stop-opacity=".18"/>
      <stop offset=".32" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="fz-plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4c2d0b"/><stop offset="1" stop-color="#2b1806"/></linearGradient>
    <radialGradient id="fz-burst" cx="50%" cy="40%" r="66%">
      <stop offset="0" stop-color="#ffeabf"/><stop offset=".5" stop-color="#e2ab45"/><stop offset="1" stop-color="#6b3f0f"/></radialGradient>
    <linearGradient id="fz-refl" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
  body: 'url(#fz-metal)', grain: .06, screw: '#3a2208',
  bg: (w) => `
    <rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="url(#fz-gloss)"/>
    <rect x="12" y="40" width="${w - 24}" height="150" rx="10" fill="url(#fz-plate)"/>
    <rect x="12" y="40" width="${w - 24}" height="150" rx="10" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="2"/>
    <rect x="13.5" y="41.5" width="${w - 27}" height="147" rx="9" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1"/>`,
  motif: `<circle cx="88" cy="112" r="64" fill="url(#fz-burst)"/>
    <g transform="translate(88 112)" opacity=".2" fill="#3a2208"><path d="M0 0 L108 -18 108 18Z"/><path d="M0 0 L90 72 62 98Z"/><path d="M0 0 L28 116 -28 116Z"/><path d="M0 0 L-90 72 -62 98Z"/><path d="M0 0 L-108 -18 -108 18Z"/><path d="M0 0 L-62 -98 -28 -116Z"/><path d="M0 0 L28 -116 62 -98Z"/></g>
    <path d="M44 110 H60 V88 H80 V130 H100 V88 H118 V110 H132" fill="none" stroke="#2a1806" stroke-opacity=".55" stroke-width="7" stroke-linejoin="miter"/>`,
  fg: (w) => `<path d="M0 0 H${(w * 0.72).toFixed(0)} L${(w * 0.4).toFixed(0)} 92 H0 Z" fill="url(#fz-refl)"/>`,
  word: (cx, f) => wm(cx, f, 'FUZZ', 36, '#2a1806', '#ffe6b0', 214) + tag(cx, 'SUSTAIN · TONE · VOL', '#f0c67a', 232, 1.5),
});

const BOOST = plate('boost', {
  defs: `<linearGradient id="bo-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f63c8"/><stop offset="1" stop-color="#0b2f6e"/></linearGradient><linearGradient id="bo-ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c5d6ee"/><stop offset="1" stop-color="#8aa6cf"/></linearGradient>`,
  body: 'url(#bo-b)', screw: '#06214f',
  bg: (w) => texW(w, '#fff', 'nz-brushV', .05),
  motif: `<path d="M88 36 L120 86 L102 86 L102 150 L74 150 L74 86 L56 86 Z" fill="url(#bo-ar)" stroke="#0a234f" stroke-width="1.5"/>
    <circle cx="138" cy="44" r="6" fill="#ff3b30" stroke="#5a0d08"/><circle cx="136" cy="42" r="2" fill="#ffd5d2"/>`,
  word: (cx, f) => wm(cx, f, 'BOOST', 30, '#06214f', '#eaf2ff', 198) + tag(cx, 'GAIN · LEVEL', '#9fc0ee', 216),
});

const GATE = plate('gate', {
  defs: `<pattern id="ga-hz" width="20" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="20" height="14" fill="#1a1c1f"/><rect width="10" height="14" fill="#e9c93a"/></pattern><linearGradient id="ga-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3d42"/><stop offset="1" stop-color="#15171a"/></linearGradient>`,
  body: 'url(#ga-b)', grain: .25, screw: '#0a0b0d',
  bg: (w) => `<rect x="8" y="8" width="${w - 16}" height="11" rx="3" fill="url(#ga-hz)" opacity=".85"/><rect x="8" y="229" width="${w - 16}" height="11" rx="3" fill="url(#ga-hz)" opacity=".85"/>`,
  motif: `<path d="M40 120 q 9 -22 18 0 t 18 0 M94 120 H140" fill="none" stroke="#e9c93a" stroke-width="6" stroke-linecap="round"/>
    <line x1="90" y1="96" x2="90" y2="146" stroke="#e9c93a" stroke-width="3" stroke-dasharray="4 5"/>`,
  word: (cx, f) => wm(cx, f, 'GATE', 28, '#000', '#e9c93a', 198, 1) + tag(cx, 'THRESH · DECAY', '#8a8d92', 216),
});

const OCTAVE = plate('octave', {
  defs: `<linearGradient id="oc-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e1620"/><stop offset="1" stop-color="#3a0a10"/></linearGradient><linearGradient id="oc-d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8e2230"/><stop offset=".5" stop-color="#4d0f16"/><stop offset="1" stop-color="#8e2230"/></linearGradient>`,
  body: 'url(#oc-b)', grain: .14, screw: '#caa24a',
  motif: `<path d="M88 30 L150 100 L88 170 L26 100 Z" fill="url(#oc-d)" stroke="#caa24a" stroke-width="2"/>
    <path d="M88 30 L88 170 M26 100 L150 100" stroke="#caa24a" stroke-opacity=".5" stroke-width="1"/>
    <path d="M58 100 L88 64 L118 100 L88 136 Z" fill="none" stroke="#e8c878" stroke-width="1.5"/>`,
  word: (cx, f) => wm(cx, f, 'OCTAVE', 26, '#1c0407', '#e8c878', 200, .5) + tag(cx, 'OCTAVE · FUZZ · TONE', '#caa24a', 218, 1),
});

const WAH = plate('wah', {
  defs: `<linearGradient id="wa-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8443a"/><stop offset="1" stop-color="#8e1810"/></linearGradient><linearGradient id="wa-pl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f4f6"/><stop offset=".5" stop-color="#aeb4ba"/><stop offset="1" stop-color="#5d646b"/></linearGradient>`,
  body: 'url(#wa-b)', screw: '#3a0a06',
  bg: (w) => texW(w, '#000', 'nz-fur', .18),
  motif: `<g stroke="#3a0a06" stroke-opacity=".5" stroke-width="3">${Array.from({ length: 7 }, (_, i) => `<line x1="36" y1="${54 + i * 10}" x2="140" y2="${48 + i * 10}"/>`).join('')}</g>
    <path d="M40 148 L138 100 L138 120 L48 162 Z" fill="url(#wa-pl)" stroke="#2b2f33"/><circle cx="52" cy="154" r="6" fill="#2b2f33"/>`,
  word: (cx, f) => wm(cx, f, 'WAH', 34, '#3a0a06', '#fff', 206) + tag(cx, 'SWEEP', '#ffd2cd', 224, 4),
});

const AUTOWAH = plate('autowah', {
  defs: `<linearGradient id="aw-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9f1c"/><stop offset="1" stop-color="#c25e00"/></linearGradient>`,
  body: 'url(#aw-b)', grain: .08, screw: '#7a3b00',
  bg: (w) => `<g opacity=".5">${Array.from({ length: 5 }, (_, i) => `<path d="M-10 ${44 + i * 30} q ${w / 4} -26 ${w / 2} 0 t ${w / 2} 0" fill="none" stroke="${i % 2 ? '#2f9e44' : '#7a3b00'}" stroke-width="7"/>`).join('')}</g>`,
  motif: `<path d="M28 120 Q88 46 148 120" fill="none" stroke="#2b1400" stroke-width="8" stroke-linecap="round"/>
    <path d="M28 120 Q88 46 148 120" fill="none" stroke="#fff3d6" stroke-width="5" stroke-linecap="round"/>`,
  word: (cx, f) => wm(cx, f, 'AUTO-WAH', 21, '#2b1400', '#fff3d6', 200, .5) + tag(cx, 'SENS · Q · DECAY', '#2f9e44', 218),
});

const CHORUS = plate('chorus', {
  defs: `<linearGradient id="ch-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc4f2"/><stop offset=".55" stop-color="#bfe3fb"/><stop offset="1" stop-color="#eaf6ff"/></linearGradient><radialGradient id="ch-sun" cx="74%" cy="20%" r="42%"><stop offset="0" stop-color="#fffdf0" stop-opacity=".95"/><stop offset="1" stop-color="#fffdf0" stop-opacity="0"/></radialGradient>`,
  body: 'url(#ch-sky)', screw: '#5aa6d8',
  bg: (w) => texW(w, '#fff', 'nz-cloud', .9) + `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="url(#ch-sun)"/>`,
  motif: `<g fill="none" stroke-linecap="round"><path d="M30 116 q 16 -14 32 0 t 32 0 t 32 0" stroke="#5aa6d8" stroke-width="4" opacity=".5"/><path d="M30 124 q 16 -14 32 0 t 32 0 t 32 0" stroke="#3f86c4" stroke-width="5"/></g>`,
  word: (cx, f) => wm(cx, f, 'CHORUS', 24, '#1f4e7a', '#dff0ff', 198) + tag(cx, 'RATE · DEPTH · MIX', '#2b6196', 216),
});

const FLANGER = plate('flanger', {
  defs: `<linearGradient id="fl-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7b4fd6"/><stop offset="1" stop-color="#3a1f7a"/></linearGradient>`,
  body: 'url(#fl-b)', grain: .12, screw: '#23114f',
  motif: `<g fill="none" stroke-linecap="round">${[0, 1, 2, 3, 4].map((i) => `<path d="M${48 + i * 15} 52 Q${76 + i * 15} 104 ${48 + i * 15} 156" stroke="${i === 0 ? '#efe6ff' : '#c9b6ff'}" stroke-width="${i === 0 ? 7 : 5}" opacity="${1 - i * .13}"/>`).join('')}</g>`,
  fg: (w) => `<g fill="#d9ccff"><circle cx="22" cy="60" r="3"/><circle cx="22" cy="150" r="3"/><circle cx="${w - 22}" cy="60" r="3"/><circle cx="${w - 22}" cy="150" r="3"/></g>`,
  word: (cx, f) => wm(cx, f, 'FLANGER', 22, '#23114f', '#efe6ff', 200) + tag(cx, 'RATE · DEPTH · FDBK', '#c9b6ff', 218),
});

const PHASER = plate('phaser', {
  defs: `<radialGradient id="ph-b" cx="50%" cy="44%" r="70%"><stop offset="0" stop-color="#ff79e6"/><stop offset=".6" stop-color="#c01f9c"/><stop offset="1" stop-color="#5e0a52"/></radialGradient>`,
  body: 'url(#ph-b)', grain: .07, screw: '#3a0735',
  motif: `<g fill="none" stroke="#ffd6f6" stroke-opacity=".4" stroke-width="6">${[26, 44, 60].map((r) => `<circle cx="88" cy="98" r="${r}"/>`).join('')}</g>
    <path d="M28 78 C62 78 62 130 100 130 C126 130 130 92 150 92" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
    <path d="M28 118 C62 118 62 66 100 66 C126 66 130 104 150 104" fill="none" stroke="#3a0735" stroke-width="6" stroke-linecap="round" opacity=".7"/>`,
  word: (cx, f) => wm(cx, f, 'PHASER', 23, '#3a0735', '#ffe3f7', 200) + tag(cx, 'RATE · DEPTH · RES', '#ffb9ee', 218),
});

const TREMOLO = plate('tremolo', {
  defs: `<linearGradient id="tr-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b5482f"/><stop offset="1" stop-color="#7a2c18"/></linearGradient>`,
  body: 'url(#tr-b)', screw: '#1c0a05',
  bg: (w) => texW(w, '#2a0f08', 'nz-streak', .35) + texW(w, '#ffcaa8', 'nz-fine', .06),
  motif: `<rect x="22" y="40" width="132" height="68" rx="6" fill="#1c0a05" opacity=".55" stroke="#e8c07a" stroke-opacity=".4"/>
    <g fill="#f1d39a">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const h = [16, 30, 44, 30, 16, 30, 44, 30][i]; return `<rect x="${32 + i * 14}" y="${94 - h}" width="8" height="${h}" rx="2"/>`; }).join('')}</g>`,
  word: (cx, f) => wm(cx, f, 'TREMOLO', 21, '#1c0a05', '#f1d39a', 200) + tag(cx, 'SPEED · DEPTH', '#e8c07a', 218),
});

const VIBRATO = plate('vibrato', {
  defs: `<linearGradient id="vi-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8732e"/><stop offset="1" stop-color="#7a481a"/></linearGradient>`,
  body: 'url(#vi-b)', screw: '#2e1a07',
  bg: (w) => texW(w, '#3a2208', 'nz-streak', .5) + texW(w, '#ffd9a8', 'nz-streak', .12),
  motif: `<path d="M36 108 q 13 -24 26 0 t 26 0 t 26 0 t 26 0" fill="none" stroke="#2e1a07" stroke-width="9" stroke-linecap="round" opacity=".6"/>
    <path d="M36 104 q 13 -24 26 0 t 26 0 t 26 0 t 26 0" fill="none" stroke="#ffae57" stroke-width="8" stroke-linecap="round"/>`,
  word: (cx, f) => wm(cx, f, 'VIBRATO', 20, '#2e1a07', '#ffe6c4', 200) + tag(cx, 'RATE · DEPTH', '#ffae57', 218),
});

const ROTARY = plate('rotary', {
  defs: `<linearGradient id="ro-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9c6b3e"/><stop offset="1" stop-color="#5e3d1f"/></linearGradient>`,
  body: 'url(#ro-b)', screw: '#241405',
  bg: (w) => texW(w, '#2e1a07', 'nz-streak', .4),
  motif: `<rect x="34" y="42" width="108" height="88" rx="6" fill="#3a2410" stroke="#c79a5a" stroke-opacity=".5"/>
    <g stroke="#c79a5a" stroke-opacity=".55" stroke-width="4">${Array.from({ length: 7 }, (_, i) => `<line x1="42" y1="${52 + i * 11}" x2="134" y2="${52 + i * 11}"/>`).join('')}</g>
    <path d="M48 54 Q88 34 128 54" fill="none" stroke="#ffe6c4" stroke-width="3" opacity=".7"/>`,
  word: (cx, f) => wm(cx, f, 'ROTARY', 23, '#241405', '#ffe6c4', 200) + tag(cx, 'SPEED · DEPTH', '#c79a5a', 218),
});

const AUTOPAN = plate('autopan', {
  defs: `<linearGradient id="ap-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset=".5" stop-color="#ff9e6b"/><stop offset="1" stop-color="#ff7eb0"/></linearGradient>`,
  body: 'url(#ap-sky)', screw: '#a8456b',
  bg: (w) => `<circle cx="${w - 56}" cy="58" r="24" fill="#fff1c4" opacity=".85"/><rect x="0" y="152" width="${w}" height="96" fill="#e9b066" opacity=".7"/>`,
  motif: `<g stroke="#2e5a3a" stroke-width="5" fill="none" stroke-linecap="round"><path d="M58 150 C56 110 54 96 66 78"/><path d="M64 80 q -26 -8 -34 4 M64 80 q -16 -22 -34 -20 M64 80 q 22 -14 40 -6 M64 80 q 10 -24 30 -22"/></g>
    <path d="M48 132 Q88 104 128 132" fill="none" stroke="#7a3b00" stroke-width="3" stroke-dasharray="3 5"/><circle cx="88" cy="109" r="6" fill="#fff"/>`,
  word: (cx, f) => wm(cx, f, 'AUTO-PAN', 20, '#7a2b3a', '#fff4e0', 200, .5) + tag(cx, 'RATE · WIDTH', '#a8456b', 218),
});

const DELAY = plate('delay', {
  defs: `<linearGradient id="de-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6b4a"/><stop offset="1" stop-color="#0c3322"/></linearGradient>`,
  body: 'url(#de-b)', grain: .14, screw: '#06140d',
  bg: (w) => `<rect x="24" y="40" width="${w - 48}" height="40" rx="5" fill="#06140d" stroke="#39d98a" stroke-opacity=".4"/><text x="${w - 36}" y="70" text-anchor="end" font-family="'Major Mono Display',monospace" font-size="24" fill="#39d98a" letter-spacing="2">375</text>`,
  motif: `<g>${[0, 1, 2, 3, 4].map((i) => `<rect x="${36 + i * 23}" y="${100 + i * 4}" width="14" height="${56 - i * 9}" rx="2" fill="#39d98a" opacity="${1 - i * .17}"/>`).join('')}</g>`,
  word: (cx, f) => wm(cx, f, 'DELAY', 25, '#06140d', '#bff4dc', 200, 1) + tag(cx, 'TIME · FDBK · MIX', '#39d98a', 218),
});

const TAPE = plate('tape-echo', {
  defs: `<linearGradient id="te-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8576"/><stop offset="1" stop-color="#155246"/></linearGradient><linearGradient id="te-c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfd"/><stop offset=".45" stop-color="#b9c0c4"/><stop offset=".5" stop-color="#7e868c"/><stop offset=".55" stop-color="#aeb5ba"/><stop offset="1" stop-color="#5b6269"/></linearGradient><radialGradient id="te-r" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#fbfbfb"/><stop offset=".6" stop-color="#aab0b5"/><stop offset="1" stop-color="#565c62"/></radialGradient>`,
  body: 'url(#te-b)', screw: '#0c3a32',
  bg: (w) => texW(w, '#fff', 'nz-brushH', .05) + `<rect x="14" y="22" width="${w - 28}" height="86" rx="9" fill="url(#te-c)" stroke="#3a4045" stroke-opacity=".6"/>`,
  motif: `<g stroke="#3a4045" stroke-width="1.5"><circle cx="56" cy="64" r="26" fill="url(#te-r)"/><circle cx="120" cy="64" r="26" fill="url(#te-r)"/></g>
    <g stroke="#5a6168" stroke-width="3" stroke-linecap="round"><line x1="56" y1="48" x2="56" y2="80"/><line x1="43" y1="56" x2="69" y2="72"/><line x1="69" y1="56" x2="43" y2="72"/><line x1="120" y1="48" x2="120" y2="80"/><line x1="107" y1="56" x2="133" y2="72"/><line x1="133" y1="56" x2="107" y2="72"/></g>
    <circle cx="56" cy="64" r="5" fill="#3a4045"/><circle cx="120" cy="64" r="5" fill="#3a4045"/>
    <path d="M56 90 Q88 100 120 90" fill="none" stroke="#2a2018" stroke-width="3" opacity=".7"/>`,
  word: (cx, f) => wm(cx, f, 'TAPE ECHO', 20, '#0f2c27', '#eafff8', 196, 1) + tag(cx, 'SPACE · TIME · MIX', '#7fd8c6', 214, 2),
});

const PINGPONG = plate('pingpong', {
  defs: `<linearGradient id="pp-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6fb0"/><stop offset="1" stop-color="#0d3a64"/></linearGradient>`,
  body: 'url(#pp-b)', grain: .1, screw: '#082742',
  motif: `<line x1="88" y1="40" x2="88" y2="150" stroke="#cfe6ff" stroke-width="3" stroke-dasharray="3 4"/>
    <path d="M40 56 L88 130 L136 56" fill="none" stroke="#ff8a3d" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="88" cy="130" r="9" fill="#ffb44d" stroke="#a85a14"/><circle cx="40" cy="56" r="5" fill="#cfe6ff"/><circle cx="136" cy="56" r="5" fill="#cfe6ff"/>`,
  word: (cx, f) => wm(cx, f, 'PING-PONG', 19, '#082742', '#dcecff', 200, 1) + tag(cx, 'TIME · SPREAD · MIX', '#ff8a3d', 218),
});

const REVERB = plate('reverb', {
  defs: `<linearGradient id="rv-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2f8f"/><stop offset="1" stop-color="#160f3a"/></linearGradient><linearGradient id="rv-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f7dff"/><stop offset="1" stop-color="#2a1f66"/></linearGradient>`,
  body: 'url(#rv-b)', grain: .12, screw: '#0e0922',
  motif: `<path d="M52 150 V86 Q88 30 124 86 V150 Z" fill="url(#rv-a)" opacity=".5" stroke="#b9aaff" stroke-opacity=".5"/>
    <path d="M68 150 V92 Q88 60 108 92 V150" fill="none" stroke="#cdc2ff" stroke-opacity=".5" stroke-width="2"/>
    <g fill="none" stroke="#cdc2ff" stroke-linecap="round"><path d="M60 150 A28 28 0 0 1 116 150" stroke-width="4" opacity=".6"/><path d="M48 150 A40 40 0 0 1 128 150" stroke-width="3" opacity=".4"/></g>`,
  word: (cx, f) => wm(cx, f, 'REVERB', 22, '#0e0922', '#e6e0ff', 200, 1) + tag(cx, 'DECAY · TONE · MIX', '#b9aaff', 218),
});

const WIDENER = plate('widener', {
  defs: `<linearGradient id="wi-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1f26"/><stop offset="1" stop-color="#0a0c10"/></linearGradient><radialGradient id="wi-g" cx="50%" cy="42%" r="60%"><stop offset="0" stop-color="#39d3ff" stop-opacity=".4"/><stop offset="1" stop-color="#39d3ff" stop-opacity="0"/></radialGradient>`,
  body: 'url(#wi-b)', grain: .15, screw: '#04222b',
  bg: (w) => `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="url(#wi-g)"/>`,
  motif: `<line x1="88" y1="46" x2="88" y2="150" stroke="#39d3ff" stroke-width="4" stroke-linecap="round"/>
    <g fill="none" stroke="#39d3ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M70 82 L54 100 L70 118"/><path d="M52 82 L36 100 L52 118" opacity=".55"/><path d="M106 82 L122 100 L106 118"/><path d="M124 82 L140 100 L124 118" opacity=".55"/></g>`,
  word: (cx, f) => wm(cx, f, 'WIDENER', 18, '#04222b', '#c8f5ff', 200, .5) + tag(cx, 'WIDTH · MIX', '#39d3ff', 218),
});

const LIMITER = plate('limiter', {
  defs: `<linearGradient id="li-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a4438"/><stop offset="1" stop-color="#6e2c22"/></linearGradient><linearGradient id="li-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8ebed"/><stop offset=".5" stop-color="#9aa1a7"/><stop offset="1" stop-color="#646b71"/></linearGradient>`,
  body: 'url(#li-b)', grain: .12, screw: '#2a120d',
  bg: (w) => `<g stroke="#3a1c16" stroke-opacity=".5" stroke-width="2">${Array.from({ length: 7 }, (_, r) => `<line x1="6" y1="${44 + r * 16}" x2="${w - 6}" y2="${44 + r * 16}"/>`).join('')}${Array.from({ length: 6 }, (_, r) => `<line x1="${(r % 2 ? 0.32 : 0.62) * w}" y1="${44 + r * 16}" x2="${(r % 2 ? 0.32 : 0.62) * w}" y2="${60 + r * 16}"/>`).join('')}</g>`,
  motif: `<rect x="20" y="74" width="136" height="9" rx="2" fill="url(#li-s)"/>
    <path d="M28 130 L44 86 L60 86 L72 130 L86 86 L102 86 L114 130 L130 96 L148 96" fill="none" stroke="#f2ead8" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`,
  word: (cx, f) => wm(cx, f, 'LIMITER', 22, '#2a120d', '#f2ead8', 200, .5) + tag(cx, 'CEIL · RELEASE', '#d6b3aa', 218),
});

const PITCHSHIFT = plate('pitchshift', {
  defs: `<linearGradient id="ps-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f5f5a"/><stop offset="1" stop-color="#062f2c"/></linearGradient><radialGradient id="ps-g" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#33e0c8" stop-opacity=".35"/><stop offset="1" stop-color="#33e0c8" stop-opacity="0"/></radialGradient>`,
  body: 'url(#ps-b)', grain: .1, screw: '#04201d',
  bg: (w) => `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="url(#ps-g)"/>`,
  motif: `<g fill="#9af6e6">${[0, 1, 2, 3].map((i) => `<rect x="${44 + i * 22}" y="${112 - i * 20}" width="20" height="10" rx="2"/>`).join('')}</g>
    <path d="M132 60 L132 40 M124 48 L132 36 L140 48" fill="none" stroke="#33e0c8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M44 40 L44 60 M36 48 L44 64 L52 48" fill="none" stroke="#33e0c8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  word: (cx, f) => wm(cx, f, 'PITCH', 24, '#04201d', '#c7fff5', 200, 1) + tag(cx, 'SHIFT · MIX', '#33e0c8', 218),
});

const LOOPER = plate('looper', {
  defs: `<linearGradient id="lo-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f7a4a"/><stop offset="1" stop-color="#0c3d24"/></linearGradient>`,
  body: 'url(#lo-b)', grain: .12, screw: '#06200f',
  motif: `<circle cx="88" cy="96" r="44" fill="none" stroke="#0a2a19" stroke-width="13"/>
    <path d="M88 52 A44 44 0 1 1 56 66" fill="none" stroke="#8af0b8" stroke-width="9" stroke-linecap="round"/>
    <path d="M56 66 L44 46 L70 48 Z" fill="#8af0b8"/>
    <circle cx="88" cy="96" r="13" fill="#ff453a" stroke="#5a0d08"/><circle cx="83" cy="91" r="4" fill="#ffd5d2"/>`,
  word: (cx, f) => wm(cx, f, 'LOOPER', 22, '#06200f', '#c4ffdd', 202, .5) + tag(cx, 'REC · PLAY · UNDO', '#8af0b8', 220),
});

const RINGMOD = plate('ringmod', {
  defs: `<radialGradient id="rm-b" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#3a3320"/><stop offset="1" stop-color="#171307"/></radialGradient>`,
  body: 'url(#rm-b)', grain: 0, screw: '#120e04',
  bg: (w) => texW(w, '#fff', 'nz-fine', .05),
  motif: `<g fill="none" stroke="#e8b84b" stroke-width="2.5" opacity=".85"><ellipse cx="88" cy="96" rx="56" ry="22"/><ellipse cx="88" cy="96" rx="56" ry="22" transform="rotate(60 88 96)"/><ellipse cx="88" cy="96" rx="56" ry="22" transform="rotate(-60 88 96)"/></g>
    <circle cx="88" cy="96" r="11" fill="#ffe18a" stroke="#7a5a14"/>
    <g fill="#ffe18a"><circle cx="142" cy="96" r="4"/><circle cx="64" cy="56" r="3"/><circle cx="112" cy="136" r="3"/></g>`,
  word: (cx, f) => wm(cx, f, 'RING MOD', 19, '#120e04', '#ffe18a', 200, .5) + tag(cx, 'FREQ · MIX', '#e8b84b', 218),
});

const COMPRESSOR = plate('compressor', {
  defs: `<linearGradient id="cm-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c7ced3"/><stop offset=".5" stop-color="#9aa1a7"/><stop offset="1" stop-color="#6e757b"/></linearGradient><radialGradient id="cm-vu" cx="50%" cy="100%" r="100%"><stop offset="0" stop-color="#fdf3d6"/><stop offset="1" stop-color="#e7d9a8"/></radialGradient>`,
  body: 'url(#cm-b)', screw: '#3a4045',
  bg: (w) => texW(w, '#fff', 'nz-brushH', .14) + texW(w, '#000', 'nz-brushH', .1),
  motif: `<rect x="30" y="36" width="116" height="56" rx="6" fill="url(#cm-vu)" stroke="#5b6168"/>
    <g stroke="#7a6a3a" stroke-width="1" fill="none">${[-30, -15, 0, 15, 30].map((a) => `<line x1="88" y1="88" x2="${(88 + 50 * Math.sin(a * Math.PI / 180)).toFixed(1)}" y2="${(88 - 50 * Math.cos(a * Math.PI / 180)).toFixed(1)}"/>`).join('')}</g>
    <line x1="88" y1="88" x2="104" y2="50" stroke="#b22" stroke-width="2"/><circle cx="88" cy="88" r="4" fill="#3a3a3a"/>
    <circle cx="130" cy="44" r="5" fill="#2e9bff" stroke="#0a3a66"/><circle cx="128" cy="42" r="1.6" fill="#cfe8ff"/>`,
  word: (cx, f) => wm(cx, f, 'COMP', 26, '#2b2f33', '#f4f6f7', 200, 1) + tag(cx, 'THRESH · RATIO · GAIN', '#5b6168', 218),
});

const ACOUSTICSIM = plate('acousticsim', {
  defs: `<linearGradient id="as-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b97f3e"/><stop offset="1" stop-color="#6e4416"/></linearGradient><radialGradient id="as-hole" cx="50%" cy="50%" r="55%"><stop offset="0" stop-color="#1a0e04"/><stop offset=".8" stop-color="#2b1806"/><stop offset="1" stop-color="#3a2410"/></radialGradient>`,
  body: 'url(#as-b)', screw: '#3a2208',
  bg: (w) => texW(w, '#2e1a07', 'nz-brushH', .35) + texW(w, '#ffd9a8', 'nz-fine', .05),
  motif: `<circle cx="88" cy="96" r="34" fill="url(#as-hole)"/>
    <circle cx="88" cy="96" r="34" fill="none" stroke="#e8c07a" stroke-width="2.5"/>
    <circle cx="88" cy="96" r="42" fill="none" stroke="#e8c07a" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="2 3"/>
    <circle cx="88" cy="96" r="48" fill="none" stroke="#5e360c" stroke-width="3"/>
    <g stroke="#f6ecd2" stroke-width="1.6" opacity=".85">${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="24" y1="${76 + i * 8}" x2="152" y2="${76 + i * 8}"/>`).join('')}</g>`,
  word: (cx, f) => wm(cx, f, 'ACOUSTIC', 19, '#2b1806', '#ffe9c4', 200, .5) + tag(cx, 'BODY · AIR · LEVEL', '#e8c07a', 218),
});

const DISTORTION = plate('distortion', {
  defs: `<linearGradient id="di-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff8b2e"/><stop offset="1" stop-color="#b34706"/></linearGradient><linearGradient id="di-bolt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6e6"/><stop offset="1" stop-color="#ffd28a"/></linearGradient>`,
  body: 'url(#di-b)', grain: .1, screw: '#5e2404',
  bg: (w) => `<rect x="10" y="38" width="${w - 20}" height="128" rx="9" fill="#2b1000" opacity=".8"/><rect x="11.5" y="39.5" width="${w - 23}" height="125" rx="8" fill="none" stroke="#ffb066" stroke-opacity=".35"/>`,
  motif: `<path d="M100 46 L58 106 H84 L72 156 L124 92 H96 L112 46 Z" fill="url(#di-bolt)" stroke="#5e2404" stroke-width="2" stroke-linejoin="miter"/>
    <path d="M40 142 H52 V118 H62 V150 H72" fill="none" stroke="#ff8b2e" stroke-opacity=".5" stroke-width="4" stroke-linejoin="miter"/>`,
  word: (cx, f) => wm(cx, f, 'DIST', 34, '#5e2404', '#fff0d6', 208) + tag(cx, 'DIST · TONE · LEVEL', '#ffcf9e', 226, 1.5),
});

const HARMONIZER = plate('harmonizer', {
  defs: `<linearGradient id="ha-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a4ba8"/><stop offset="1" stop-color="#101f4e"/></linearGradient><radialGradient id="ha-g" cx="50%" cy="38%" r="62%"><stop offset="0" stop-color="#7d9dff" stop-opacity=".35"/><stop offset="1" stop-color="#7d9dff" stop-opacity="0"/></radialGradient>`,
  body: 'url(#ha-b)', grain: .1, screw: '#0a1638',
  bg: (w) => `<rect x="0" y="0" width="${w}" height="${HEIGHT}" rx="14" fill="url(#ha-g)"/><g stroke="#9db9ff" stroke-opacity=".28" stroke-width="1.5">${[0, 1, 2, 3, 4].map((i) => `<line x1="20" y1="${58 + i * 13}" x2="156" y2="${58 + i * 13}"/>`).join('')}</g>`,
  motif: `<g stroke="#e6edff" stroke-width="5" fill="none"><path d="M58 132 V70 L86 62 V124"/></g><ellipse cx="49" cy="132" rx="10" ry="7" fill="#e6edff"/><ellipse cx="77" cy="124" rx="10" ry="7" fill="#e6edff"/>
    <g opacity=".55"><path d="M112 110 V48 L140 40 V102" stroke="#9db9ff" stroke-width="5" fill="none"/><ellipse cx="103" cy="110" rx="10" ry="7" fill="#9db9ff"/><ellipse cx="131" cy="102" rx="10" ry="7" fill="#9db9ff"/></g>`,
  word: (cx, f) => wm(cx, f, 'HARMONY', 19, '#0a1638', '#dbe6ff', 200, 1) + tag(cx, 'INTERVAL · MIX', '#9db9ff', 218),
});

const UNIVIBE = plate('univibe', {
  defs: `<linearGradient id="uv-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3ead2"/><stop offset=".5" stop-color="#e3d4ae"/><stop offset="1" stop-color="#bfa678"/></linearGradient><radialGradient id="uv-lamp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fff8dc"/><stop offset=".55" stop-color="#ffd76e"/><stop offset="1" stop-color="#b8862a" stop-opacity="0"/></radialGradient>`,
  body: 'url(#uv-b)', grain: .07, screw: '#6e5a32',
  bg: (w) => `<rect x="10" y="36" width="${w - 20}" height="120" rx="10" fill="#274a86"/><rect x="11.5" y="37.5" width="${w - 23}" height="117" rx="9" fill="none" stroke="#9db9ff" stroke-opacity=".4"/>`,
  motif: `<circle cx="88" cy="66" r="15" fill="url(#uv-lamp)"/>
    <path d="M30 112 q 14 -24 28 0 t 28 0 t 28 0 t 28 0" fill="none" stroke="#8fb4ff" stroke-width="5" stroke-linecap="round"/>
    <g fill="#f3ead2" stroke="#274a86" stroke-width="1.5"><circle cx="44" cy="100" r="6"/><circle cx="72" cy="124" r="6"/><circle cx="100" cy="100" r="6"/><circle cx="128" cy="124" r="6"/></g>`,
  word: (cx, f) => wm(cx, f, 'UNI-VIBE', 21, '#6e5a32', '#274a86', 200, .5) + tag(cx, 'SPEED · INTENSITY · MIX', '#6e5a32', 218, 1),
});

const SPRINGVERB = plate('springverb', {
  defs: `<linearGradient id="sp-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3f8f78"/><stop offset="1" stop-color="#1a4a3c"/></linearGradient><linearGradient id="sp-coil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2f4f6"/><stop offset=".5" stop-color="#9aa7a4"/><stop offset="1" stop-color="#5d6a66"/></linearGradient>`,
  body: 'url(#sp-b)', screw: '#0c2a22',
  bg: (w) => texW(w, '#0c2a22', 'nz-fur', .22) + `<rect x="12" y="52" width="${w - 24}" height="88" rx="8" fill="#0c2a22" opacity=".75"/><rect x="13.5" y="53.5" width="${w - 27}" height="85" rx="7" fill="none" stroke="#7fe0c2" stroke-opacity=".35"/>`,
  motif: `<circle cx="30" cy="96" r="6" fill="url(#sp-coil)" stroke="#0c2a22"/><circle cx="146" cy="96" r="6" fill="url(#sp-coil)" stroke="#0c2a22"/>
    <path d="M36 96 H44 ${Array.from({ length: 8 }, (_, i) => `L${52 + i * 11} ${i % 2 ? 116 : 76}`).join(' ')} L136 96 H140" fill="none" stroke="url(#sp-coil)" stroke-width="4.5" stroke-linejoin="round"/>
    <g fill="none" stroke="#7fe0c2" stroke-linecap="round"><path d="M60 152 q6 8 0 16" stroke-width="3" opacity=".8"/><path d="M78 152 q6 8 0 16" stroke-width="3" opacity=".55"/><path d="M96 152 q6 8 0 16" stroke-width="3" opacity=".35"/></g>`,
  word: (cx, f) => wm(cx, f, 'SPRING', 23, '#0c2a22', '#d6fff1', 200, 1) + tag(cx, 'TENSION · DECAY · MIX', '#7fe0c2', 218),
});

const WHAMMY = plate('whammy', {
  defs: `<linearGradient id="wh-b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4a40"/><stop offset="1" stop-color="#8e0e08"/></linearGradient><linearGradient id="wh-tread" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2f33"/><stop offset="1" stop-color="#101214"/></linearGradient>`,
  body: 'url(#wh-b)', grain: .08, screw: '#4a0703',
  bg: (w) => texW(w, '#000', 'nz-fine', .07),
  motif: `<path d="M34 148 L130 108 L136 128 L44 166 Z" fill="url(#wh-tread)" stroke="#000" stroke-opacity=".5"/>
    <g stroke="#ff8a80" stroke-width="2" opacity=".8">${[0, 1, 2, 3].map((i) => `<line x1="${52 + i * 20}" y1="${142 - i * 8}" x2="${58 + i * 20}" y2="${156 - i * 8}"/>`).join('')}</g>
    <path d="M40 96 Q88 96 116 52" fill="none" stroke="#ffe1de" stroke-width="6" stroke-linecap="round"/>
    <path d="M128 30 L124 58 L102 42 Z" fill="#ffe1de"/>
    <text x="46" y="66" font-family="'Helvetica Neue',Arial,sans-serif" font-weight="800" font-size="15" fill="#ffd2cd">+12</text>`,
  word: (cx, f) => wm(cx, f, 'WHAMMY', 24, '#4a0703', '#ffe9e6', 206) + tag(cx, 'BEND · RANGE · MIX', '#ff9d94', 224, 1.5),
});

const SYMBOLS = [
  FUZZ, BOOST, GATE, OCTAVE, WAH, AUTOWAH,
  CHORUS, FLANGER, PHASER, TREMOLO, VIBRATO, ROTARY, AUTOPAN,
  DELAY, TAPE, PINGPONG, REVERB, WIDENER,
  LIMITER, PITCHSHIFT, LOOPER, RINGMOD, COMPRESSOR,
  ACOUSTICSIM, DISTORTION, HARMONIZER, UNIVIBE, SPRINGVERB, WHAMMY,
];

export const FX_ART_SHEET =
  `<svg id="fx-art-sheet" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${FILTERS}</defs>${SYMBOLS.join('')}</svg>`;

export function ensureFxArtSheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('fx-art-sheet')) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = FX_ART_SHEET.trim();
  document.body.appendChild(tpl.content.firstChild);
}

export function fxArtSvg(type) {
  ensureFxArtSheet();
  const w = fxWidth(type);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fx-art');
  svg.setAttribute('viewBox', `0 0 ${w} ${HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#fx-art-${type}`);
  svg.appendChild(use);
  return svg;
}
