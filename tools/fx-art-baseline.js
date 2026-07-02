// src/chain-ui/fx-art.js
// Bespoke per-pedal faceplate art. Each effect is its own product: unique body
// color, texture, trim and a baked-in stylized wordmark — no shared template.
// Pedal WIDTH scales with knob count (like GarageBand) so the art holds exactly
// the right number of controls; height is fixed at 248. Pure inline SVG, injected
// once as a hidden <symbol> sprite. Controls overlay on top in the DOM.

export const FX_FONTS = {
  fuzz:   { family: "'Bungee', sans-serif", ls: '.02em' },
  boost:  { family: "'Bungee', sans-serif", ls: '.02em' },
  octave: { family: "'Bungee', sans-serif", ls: '.02em' },
  chorus:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  flanger: { family: "'Audiowide', sans-serif", ls: '.04em' },
  phaser:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  tremolo: { family: "'Audiowide', sans-serif", ls: '.04em' },
  vibrato: { family: "'Audiowide', sans-serif", ls: '.04em' },
  rotary:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  autopan: { family: "'Audiowide', sans-serif", ls: '.04em' },
  delay:   { family: "'Orbitron', sans-serif", ls: '.08em' },
  reverb:  { family: "'Orbitron', sans-serif", ls: '.08em' },
  pingpong:{ family: "'Orbitron', sans-serif", ls: '.08em' },
  widener: { family: "'Orbitron', sans-serif", ls: '.08em' },
  'tape-echo': { family: "'Special Elite', monospace", ls: '.06em' },
  wah:     { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  autowah: { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  compressor: { family: "'Major Mono Display', monospace", ls: '.02em' },
  gate:       { family: "'Major Mono Display', monospace", ls: '.02em' },
  limiter:    { family: "'Major Mono Display', monospace", ls: '.02em' },
  pitchshift: { family: "'Major Mono Display', monospace", ls: '.02em' },
  looper:     { family: "'Major Mono Display', monospace", ls: '.02em' },
  ringmod:    { family: "'Major Mono Display', monospace", ls: '.02em' },
};

export const FX_COLORS = {
  compressor: '#8fa3b0', boost: '#2e9bff', gate: '#e9c93a', fuzz: '#e0a943', octave: '#d4a017',
  wah: '#ff5a4d', autowah: '#ff9f1c', chorus: '#5aa6d8', flanger: '#b08bff', phaser: '#ff4fd8',
  tremolo: '#e8c07a', vibrato: '#ffa64d', autopan: '#ffcf5a', rotary: '#caa06a', ringmod: '#e8b84b',
  delay: '#39d98a', 'tape-echo': '#7fd8c6', pingpong: '#ff8a3d', reverb: '#8f7dff', widener: '#39d3ff',
  limiter: '#9aa6ad', pitchshift: '#33e0c8', looper: '#39d98a',
};

// Knob count per effect (from the effect schemas) → drives pedal width.
export const FX_KNOBS = {
  compressor: 5, boost: 3, gate: 2, fuzz: 3, octave: 4, wah: 3, autowah: 4,
  chorus: 3, flanger: 4, phaser: 4, tremolo: 3, vibrato: 2, autopan: 3, rotary: 3, ringmod: 2,
  delay: 4, 'tape-echo': 5, pingpong: 4, reverb: 2, widener: 1,
  limiter: 2, pitchshift: 2, looper: 2,
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
  return `<symbol id="fx-art-old-${id}" viewBox="0 0 ${w} ${HEIGHT}" preserveAspectRatio="xMidYMid meet">`
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
const FUZZ = plate('fuzz', {
  defs: `<radialGradient id="fz-burst" cx="50%" cy="42%" r="64%"><stop offset="0" stop-color="#fbeec8"/><stop offset=".55" stop-color="#e0a943"/><stop offset="1" stop-color="#7c4a12"/></radialGradient>`,
  body: '#cf8f33', grain: .1, screw: '#6b4514',
  motif: `<circle cx="88" cy="100" r="76" fill="url(#fz-burst)"/>
    <g transform="translate(88 100)" opacity=".22" fill="#5e360c"><path d="M0 0 L120 -20 120 20Z"/><path d="M0 0 L100 80 70 110Z"/><path d="M0 0 L30 130 -30 130Z"/><path d="M0 0 L-100 80 -70 110Z"/><path d="M0 0 L-120 -20 -120 20Z"/><path d="M0 0 L-70 -110 -30 -130Z"/><path d="M0 0 L30 -130 70 -110Z"/></g>
    <path d="M40 94 H60 V68 H82 V118 H106 V68 H128 V94 H146" fill="none" stroke="#3a2208" stroke-opacity=".5" stroke-width="7" stroke-linejoin="miter"/>`,
  word: (cx, f) => wm(cx, f, 'FUZZ', 38, '#3a2208', '#fbe6b0', 204) + tag(cx, 'SUSTAIN · TONE · VOL', '#5e360c', 224, 1.5),
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

const SYMBOLS = [
  FUZZ, BOOST, GATE, OCTAVE, WAH, AUTOWAH,
  CHORUS, FLANGER, PHASER, TREMOLO, VIBRATO, ROTARY, AUTOPAN,
  DELAY, TAPE, PINGPONG, REVERB, WIDENER,
  LIMITER, PITCHSHIFT, LOOPER, RINGMOD, COMPRESSOR,
];

export const FX_ART_SHEET =
  `<svg id="fx-art-old-sheet" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${FILTERS}</defs>${SYMBOLS.join('')}</svg>`;

export function ensureFxArtSheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('fx-art-old-sheet')) return;
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
  use.setAttribute('href', `#fx-art-old-${type}`);
  svg.appendChild(use);
  return svg;
}
