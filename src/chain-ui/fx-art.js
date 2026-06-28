// src/chain-ui/fx-art.js
// Bespoke screen-print cover art for each pedal effect. One injected <symbol>
// sprite (recolored per host via --c) + a per-effect nameplate font map.
//
// Every symbol uses viewBox 0 0 160 120 + preserveAspectRatio slice so the same
// art crops cleanly to the wide palette thumbnail AND the portrait pedal face.
// Shared per-symbol recipe: warm base -> optional sunburst -> glow -> off-register
// ink shadow of the motif -> the cream motif -> grain -> vignette.

export const FX_FONTS = {
  // Dirt — bold vintage signage
  fuzz:   { family: "'Bungee', sans-serif", ls: '.02em' },
  boost:  { family: "'Bungee', sans-serif", ls: '.02em' },
  octave: { family: "'Bungee', sans-serif", ls: '.02em' },
  // Modulation — retro-futuristic groove
  chorus:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  flanger: { family: "'Audiowide', sans-serif", ls: '.04em' },
  phaser:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  tremolo: { family: "'Audiowide', sans-serif", ls: '.04em' },
  vibrato: { family: "'Audiowide', sans-serif", ls: '.04em' },
  rotary:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  autopan: { family: "'Audiowide', sans-serif", ls: '.04em' },
  // Time / space — spacey/ambient
  delay:   { family: "'Orbitron', sans-serif", ls: '.08em' },
  reverb:  { family: "'Orbitron', sans-serif", ls: '.08em' },
  pingpong:{ family: "'Orbitron', sans-serif", ls: '.08em' },
  widener: { family: "'Orbitron', sans-serif", ls: '.08em' },
  'tape-echo': { family: "'Special Elite', monospace", ls: '.06em' },
  // Funk
  wah:     { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  autowah: { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  // Utility / tech — technical mono
  compressor: { family: "'Major Mono Display', monospace", ls: '.02em' },
  gate:       { family: "'Major Mono Display', monospace", ls: '.02em' },
  limiter:    { family: "'Major Mono Display', monospace", ls: '.02em' },
  pitchshift: { family: "'Major Mono Display', monospace", ls: '.02em' },
  looper:     { family: "'Major Mono Display', monospace", ls: '.02em' },
  ringmod:    { family: "'Major Mono Display', monospace", ls: '.02em' },
};

const DEFS = `
  <filter id="fx-grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/>
    <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0"/>
    <feComposite operator="in" in2="SourceGraphic"/></filter>
  <radialGradient id="fx-glow" cx="50%" cy="38%" r="75%">
    <stop offset="0%" stop-color="var(--c)" stop-opacity=".55"/>
    <stop offset="45%" stop-color="var(--c)" stop-opacity=".16"/>
    <stop offset="100%" stop-color="var(--c)" stop-opacity="0"/></radialGradient>
  <linearGradient id="fx-vig" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000" stop-opacity=".35"/><stop offset="35%" stop-color="#000" stop-opacity="0"/>
    <stop offset="72%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".6"/></linearGradient>
  <linearGradient id="fx-ink" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#f6ecd2"/><stop offset="100%" stop-color="#e7c79a"/></linearGradient>`;

// Wrap a motif in the shared base / glow / grain / vignette layers.
// `rays` and `motif` are SVG fragment strings.
function scene(id, { base = '#15100f', rays = '', motif }) {
  return `<symbol id="fx-art-${id}" viewBox="0 0 160 120" preserveAspectRatio="xMidYMid slice">
    <rect width="160" height="120" fill="${base}"/>
    ${rays}
    <rect width="160" height="120" fill="url(#fx-glow)"/>
    ${motif}
    <rect width="160" height="120" filter="url(#fx-grain)" opacity=".5"/>
    <rect width="160" height="120" fill="url(#fx-vig)"/>
  </symbol>`;
}

const SUNBURST = `<g transform="translate(80 46)" opacity=".5"><g fill="var(--c)" fill-opacity=".14">
  <path d="M0 0 L200 -26 200 26Z"/><path d="M0 0 L185 70 150 110Z"/><path d="M0 0 L110 150 60 175Z"/>
  <path d="M0 0 L-110 150 -60 175Z"/><path d="M0 0 L-185 70 -150 110Z"/><path d="M0 0 L-200 -26 -200 26Z"/>
  <path d="M0 0 L-150 -110 -185 -70Z"/><path d="M0 0 L0 -200 60 -175Z"/><path d="M0 0 L150 -110 60 -175Z"/></g></g>`;

// ---------------------------------------------------------------------------
// Symbols. Each motif draws an off-register var(--c) shadow first, then the
// cream (url(#fx-ink)) shape on top — the silk-screen misprint that reads as
// hand-designed.
// ---------------------------------------------------------------------------

// Screen-print pair: draw a paint-parameterized fragment as an off-register
// var(--c) ghost, then the cream (#fx-ink) shape on top. `frag` is a function
// (paint) => svgString that paints with whatever `paint` it is handed.
function screen(frag) {
  return `<g opacity=".85" transform="translate(2.5 3)">${frag('var(--c)')}</g>${frag('url(#fx-ink)')}`;
}

// A sine path across the full width; x0 shifts phase, amp the height.
const sine = (y, amp, p, w, x0 = 4) =>
  `<path d="M${x0} ${y} q 16 ${-amp} 32 0 t 32 0 t 32 0 t 32 0 t 32 0" fill="none" stroke="${p}" stroke-width="${w}" stroke-linecap="round"/>`;

// ---- Dirt ----------------------------------------------------------------
// Fuzz — fat clipped square-wave over a sunburst.
const FUZZ = scene('fuzz', { base: '#1a0e10', rays: SUNBURST, motif: `
  <path d="M-6 78 H22 V40 H50 V86 H78 V34 H106 V82 H134 V46 H166" fill="none"
        stroke="var(--c)" stroke-opacity=".85" stroke-width="13" stroke-linejoin="miter" transform="translate(2.5 3)"/>
  <path d="M-6 78 H22 V40 H50 V86 H78 V34 H106 V82 H134 V46 H166" fill="none"
        stroke="url(#fx-ink)" stroke-width="11" stroke-linejoin="miter"/>` });

// Boost — rising staircase of bars topped by an up-chevron burst.
const fBoost = (p) => `
  <rect x="32" y="74" width="13" height="20" rx="2" fill="${p}"/>
  <rect x="52" y="60" width="13" height="34" rx="2" fill="${p}"/>
  <rect x="72" y="46" width="13" height="48" rx="2" fill="${p}"/>
  <rect x="92" y="32" width="13" height="62" rx="2" fill="${p}"/>
  <rect x="112" y="18" width="13" height="76" rx="2" fill="${p}"/>
  <path d="M70 32 L86 14 L102 32" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
const BOOST = scene('boost', { base: '#1a1206', rays: SUNBURST, motif: screen(fBoost) });

// Octave — two clipped square-waves an octave (double frequency) apart.
const fOct = (p) => `
  <path d="M28 82 V58 H58 V82 H88 V58 H118 V82 H132" fill="none" stroke="${p}" stroke-width="8" stroke-linejoin="miter"/>
  <path d="M28 40 V24 H44 V40 H60 V24 H76 V40 H92 V24 H108 V40 H124 V24 H132" fill="none" stroke="${p}" stroke-width="5" stroke-linejoin="miter"/>`;
const OCTAVE = scene('octave', { base: '#1a0c12', rays: SUNBURST, motif: screen(fOct) });

// ---- Modulation ----------------------------------------------------------
// Chorus — three detuned sine waves; the rear two literally tinted (the shimmer).
const CHORUS = scene('chorus', { base: '#0c1620', motif: `
  ${sine(50, 15, 'var(--c)', 6, -8)}
  ${sine(66, 15, 'var(--c)', 6, 10)}
  <g opacity=".85" transform="translate(2.5 3)">${sine(58, 15, 'var(--c)', 7, 0)}</g>
  ${sine(58, 15, 'url(#fx-ink)', 7, 0)}` });

// Flanger — evenly-nested comb-sweep arcs (a jet "whoosh"), front arc boldest.
const fFlan = (p) => [0, 1, 2, 3, 4].map((i) => {
  const cx = 34 + i * 18;
  return `<path d="M${cx} 26 Q${cx + 30} 60 ${cx} 94" fill="none" stroke="${p}" stroke-width="${i === 0 ? 7 : 5}" stroke-linecap="round" opacity="${1 - i * 0.13}"/>`;
}).join('');
const FLANGER = scene('flanger', { base: '#10101c', motif: screen(fFlan) });

// Phaser — two interlocking S-curves crossing at center.
const fPhase = (p) => `
  <path d="M16 34 C56 34 56 92 96 92 C120 92 124 60 144 60" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round"/>
  <path d="M16 86 C56 86 56 28 96 28 C120 28 124 60 144 60" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round"/>`;
const PHASER = scene('phaser', { base: '#150c1a', motif: screen(fPhase) });

// Tremolo — bars throbbing on a sine amplitude envelope.
const fTrem = (p) => `<g fill="${p}">
  <rect x="20" y="50" width="8" height="14" rx="2"/><rect x="33" y="42" width="8" height="30" rx="2"/>
  <rect x="46" y="34" width="8" height="46" rx="2"/><rect x="59" y="42" width="8" height="30" rx="2"/>
  <rect x="72" y="50" width="8" height="14" rx="2"/><rect x="85" y="42" width="8" height="30" rx="2"/>
  <rect x="98" y="34" width="8" height="46" rx="2"/><rect x="111" y="42" width="8" height="30" rx="2"/>
  <rect x="124" y="50" width="8" height="14" rx="2"/></g>`;
const TREMOLO = scene('tremolo', { base: '#0a1620', motif: screen(fTrem) });

// Vibrato — one bold pitch-wobble line.
const fVib = (p) => `<path d="M8 58 q 16 -26 32 0 t 32 0 t 32 0 t 32 0 t 32 0" fill="none" stroke="${p}" stroke-width="9" stroke-linecap="round"/>`;
const VIBRATO = scene('vibrato', { base: '#0a1a1e', motif: screen(fVib) });

// Rotary — a Leslie horn cone with spin motion-arcs.
const fRot = (p) => `
  <path d="M62 86 L72 50 Q80 40 88 50 L98 86 Z" fill="${p}"/>
  <circle cx="80" cy="86" r="7" fill="${p}"/>
  <path d="M40 44 Q80 24 120 44" fill="none" stroke="${p}" stroke-width="5" stroke-linecap="round"/>
  <path d="M34 58 Q80 32 126 58" fill="none" stroke="${p}" stroke-width="4" stroke-linecap="round"/>`;
const ROTARY = scene('rotary', { base: '#1a140c', motif: screen(fRot) });

// Auto-Pan — a dot mid-arc between two inward-facing speakers.
const fPan = (p) => `
  <path d="M20 44 L34 44 L46 34 L46 74 L34 64 L20 64 Z" fill="${p}"/>
  <path d="M140 44 L126 44 L114 34 L114 74 L126 64 L140 64 Z" fill="${p}"/>
  <path d="M50 70 Q80 30 110 70" fill="none" stroke="${p}" stroke-width="3" stroke-dasharray="3 5" stroke-linecap="round"/>
  <circle cx="80" cy="44" r="7" fill="${p}"/>`;
const AUTOPAN = scene('autopan', { base: '#08191a', motif: screen(fPan) });

// ---- Time / space --------------------------------------------------------
// Delay — a transient spike with decaying echo bars.
const fDelay = (p) => `
  <rect x="26" y="30" width="9" height="60" rx="2" fill="${p}"/>
  <rect x="50" y="44" width="8" height="46" rx="2" fill="${p}" opacity=".85"/>
  <rect x="72" y="56" width="8" height="34" rx="2" fill="${p}" opacity=".7"/>
  <rect x="94" y="66" width="8" height="24" rx="2" fill="${p}" opacity=".55"/>
  <rect x="116" y="74" width="8" height="16" rx="2" fill="${p}" opacity=".4"/>`;
const DELAY = scene('delay', { base: '#1a1606', motif: screen(fDelay) });

// Reverb — concentric ripple arcs expanding from a low source.
const fRev = (p) => `<g fill="none" stroke="${p}" stroke-linecap="round">
  <path d="M52 96 A28 28 0 0 1 108 96" stroke-width="7"/>
  <path d="M38 96 A42 42 0 0 1 122 96" stroke-width="6" opacity=".7"/>
  <path d="M24 96 A56 56 0 0 1 136 96" stroke-width="5" opacity=".5"/>
  <path d="M12 96 A68 68 0 0 1 148 96" stroke-width="4" opacity=".34"/></g>
  <circle cx="80" cy="96" r="4" fill="${p}"/>`;
const REVERB = scene('reverb', { base: '#1a0810', motif: screen(fRev) });

// Tape Echo — two tape reels joined by a warbling tape path.
const fTape = (p) => `
  <g fill="none" stroke="${p}" stroke-width="6"><circle cx="52" cy="52" r="19"/><circle cx="108" cy="52" r="19"/></g>
  <circle cx="52" cy="52" r="5" fill="${p}"/><circle cx="108" cy="52" r="5" fill="${p}"/>
  <path d="M52 71 q 14 13 28 0 t 28 0" fill="none" stroke="${p}" stroke-width="4" stroke-linecap="round"/>`;
const TAPE_ECHO = scene('tape-echo', { base: '#171206', motif: screen(fTape) });

// Ping-Pong — a zig-zag bouncing between walls, dot at the vertex.
const fPing = (p) => `
  <path d="M22 28 L72 88 L122 28" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M72 88 L112 52" fill="none" stroke="${p}" stroke-width="5" stroke-linecap="round" opacity=".6"/>
  <circle cx="72" cy="88" r="7" fill="${p}"/><circle cx="22" cy="28" r="5" fill="${p}"/><circle cx="122" cy="28" r="5" fill="${p}"/>`;
const PINGPONG = scene('pingpong', { base: '#1a1408', motif: screen(fPing) });

// Widener — a center axis with chevrons pushing the stereo field outward.
const fWide = (p) => `
  <line x1="80" y1="26" x2="80" y2="86" stroke="${p}" stroke-width="5" stroke-linecap="round"/>
  <g fill="none" stroke="${p}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M58 42 L44 56 L58 70"/><path d="M40 42 L26 56 L40 70" opacity=".6"/>
  <path d="M102 42 L116 56 L102 70"/><path d="M120 42 L134 56 L120 70" opacity=".6"/></g>`;
const WIDENER = scene('widener', { base: '#0e0c1c', motif: screen(fWide) });

// ---- Funk ----------------------------------------------------------------
// Wah — a tilted treadle pedal with a sweeping resonant peak above.
const fWah = (p) => `
  <path d="M30 88 L118 64 L120 80 L40 100 Z" fill="${p}"/>
  <path d="M120 60 L132 56 L132 70 L120 76 Z" fill="${p}" opacity=".7"/>
  <path d="M24 52 Q80 6 136 52" fill="none" stroke="${p}" stroke-width="6" stroke-linecap="round"/>`;
const WAH = scene('wah', { base: '#1a1606', motif: screen(fWah) });

// Auto-Wah — a resonant formant bump circled by an auto/refresh loop arrow.
const fAwah = (p) => `
  <path d="M22 80 Q80 8 138 80" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round"/>
  <path d="M60 38 A24 24 0 1 1 56 42" fill="none" stroke="${p}" stroke-width="5" stroke-linecap="round"/>
  <path d="M56 42 L50 31 L63 33 Z" fill="${p}"/>`;
const AUTOWAH = scene('autowah', { base: '#0a1a0c', motif: screen(fAwah) });

// ---- Utility / tech ------------------------------------------------------
// Compressor — a wave squeezed by two clamp bars with inward arrows.
const fComp = (p) => `
  <line x1="22" y1="30" x2="138" y2="30" stroke="${p}" stroke-width="6" stroke-linecap="round"/>
  <line x1="22" y1="90" x2="138" y2="90" stroke="${p}" stroke-width="6" stroke-linecap="round"/>
  <g fill="${p}"><path d="M52 31 L60 41 L44 41 Z"/><path d="M80 31 L88 41 L72 41 Z"/><path d="M108 31 L116 41 L100 41 Z"/>
  <path d="M52 89 L60 79 L44 79 Z"/><path d="M80 89 L88 79 L72 79 Z"/><path d="M108 89 L116 79 L100 79 Z"/></g>
  <path d="M22 60 q 14 -10 29 0 t 29 0 t 29 0 t 29 0" fill="none" stroke="${p}" stroke-width="6" stroke-linecap="round"/>`;
const COMPRESSOR = scene('compressor', { base: '#08121c', motif: screen(fComp) });

// Noise Gate — a wave hard-cut to silence at a dashed threshold.
const fGate = (p) => `
  <path d="M16 58 q 10 -22 20 0 t 20 0 t 20 0" fill="none" stroke="${p}" stroke-width="6" stroke-linecap="round"/>
  <line x1="96" y1="58" x2="140" y2="58" stroke="${p}" stroke-width="6" stroke-linecap="round"/>`;
const GATE = scene('gate', { base: '#141416', motif:
  screen(fGate) + `<line x1="92" y1="28" x2="92" y2="90" stroke="var(--c)" stroke-width="4" stroke-dasharray="4 5" stroke-linecap="round"/>` });

// Limiter — peaks clipped flat against a hard ceiling (brick wall).
const LIMITER = scene('limiter', { base: '#08121c', motif: `
  <path d="M18 88 L38 36 L58 36 L70 88 L86 36 L106 36 L118 88 L134 48 L142 48" fill="none"
        stroke="var(--c)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity=".85" transform="translate(2.5 3)"/>
  <path d="M18 88 L38 36 L58 36 L70 88 L86 36 L106 36 L118 88 L134 48 L142 48" fill="none"
        stroke="url(#fx-ink)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="16" y1="33" x2="144" y2="33" stroke="var(--c)" stroke-width="4" stroke-dasharray="6 5" stroke-linecap="round"/>` });

// Pitch Shift — a stepped pitch ladder with up & down arrows.
const fPitch = (p) => `
  <g fill="${p}"><rect x="26" y="74" width="20" height="9" rx="2"/><rect x="54" y="60" width="20" height="9" rx="2"/>
  <rect x="82" y="46" width="20" height="9" rx="2"/><rect x="110" y="32" width="20" height="9" rx="2"/></g>
  <path d="M120 28 L120 14 M114 20 L120 12 L126 20" fill="none" stroke="${p}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M36 87 L36 101 M30 95 L36 103 L42 95" fill="none" stroke="${p}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
const PITCHSHIFT = scene('pitchshift', { base: '#1a0810', motif: screen(fPitch) });

// Looper — a circular loop arrow over a small layered-loop stack.
const fLoop = (p) => `
  <path d="M52 38 A30 30 0 1 1 48 42" fill="none" stroke="${p}" stroke-width="7" stroke-linecap="round"/>
  <path d="M48 42 L42 28 L58 32 Z" fill="${p}"/>
  <g fill="${p}"><rect x="66" y="56" width="28" height="7" rx="2"/><rect x="70" y="68" width="20" height="7" rx="2" opacity=".7"/></g>`;
const LOOPER = scene('looper', { base: '#0a1a0e', motif: screen(fLoop) });

// Ring Mod — two intersecting carriers with radiating sideband ticks.
const fRing = (p) => `
  <g fill="none" stroke="${p}" stroke-width="6"><circle cx="66" cy="56" r="22"/><circle cx="96" cy="56" r="22"/></g>
  <g stroke="${p}" stroke-width="4" stroke-linecap="round">
  <line x1="81" y1="22" x2="81" y2="10"/><line x1="81" y1="90" x2="81" y2="102"/>
  <line x1="36" y1="56" x2="26" y2="56"/><line x1="126" y1="56" x2="136" y2="56"/>
  <line x1="48" y1="28" x2="42" y2="20"/><line x1="114" y1="28" x2="120" y2="20"/></g>`;
const RINGMOD = scene('ringmod', { base: '#16140c', motif: screen(fRing) });

const SYMBOLS = [
  FUZZ, BOOST, OCTAVE,
  CHORUS, FLANGER, PHASER, TREMOLO, VIBRATO, ROTARY, AUTOPAN,
  DELAY, REVERB, TAPE_ECHO, PINGPONG, WIDENER,
  WAH, AUTOWAH,
  COMPRESSOR, GATE, LIMITER, PITCHSHIFT, LOOPER, RINGMOD,
];

export const FX_ART_SHEET =
  `<svg id="fx-art-sheet" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${DEFS}${SYMBOLS.join('')}</defs></svg>`;

export function ensureFxArtSheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('fx-art-sheet')) return;
  const tpl = document.createElement('template');
  tpl.innerHTML = FX_ART_SHEET.trim();
  document.body.appendChild(tpl.content.firstChild);
}

export function fxArtSvg(type) {
  ensureFxArtSheet();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fx-art');
  svg.setAttribute('viewBox', '0 0 160 120');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#fx-art-${type}`);
  svg.appendChild(use);
  return svg;
}

// Color map mirrors pedalboard COLORS — exported so the gallery/tooling can tint
// symbols without importing the pedalboard module.
export const FX_COLORS = {
  compressor: '#0a84ff', boost: '#ff9500', gate: '#8e8e93', fuzz: '#ff453a', octave: '#ff6482',
  wah: '#ffd60a', autowah: '#30d158', chorus: '#5ac8fa', flanger: '#7d7aff', phaser: '#bf5af2',
  tremolo: '#64d2ff', vibrato: '#40c8e0', autopan: '#00c7be', rotary: '#a2845e', ringmod: '#ac8e68',
  delay: '#ffd60a', 'tape-echo': '#d4a017', pingpong: '#ffc857', reverb: '#ff375f', widener: '#5e5ce6',
  limiter: '#0a84ff', pitchshift: '#ff2d55', looper: '#34c759',
};
