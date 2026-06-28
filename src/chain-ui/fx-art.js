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

// Fuzz — fat clipped square-wave over a sunburst.
const FUZZ = scene('fuzz', { base: '#1a0e10', rays: SUNBURST, motif: `
  <path d="M-6 78 H22 V40 H50 V86 H78 V34 H106 V82 H134 V46 H166" fill="none"
        stroke="var(--c)" stroke-opacity=".85" stroke-width="13" stroke-linejoin="miter" transform="translate(2.5 3)"/>
  <path d="M-6 78 H22 V40 H50 V86 H78 V34 H106 V82 H134 V46 H166" fill="none"
        stroke="url(#fx-ink)" stroke-width="11" stroke-linejoin="miter"/>` });

// Tasks 4-8 append their symbols to this array.
const SYMBOLS = [FUZZ];

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
