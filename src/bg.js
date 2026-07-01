// Ambient background manager.
//
// Mounts ONE animated background into #bg-fx (a fixed layer behind the studio
// UI). Effects are vanilla ports of react-bits backgrounds (MIT + Commons
// Clause; see assets/LICENSE-react-bits.md) running on vendored ogl / raw WebGL.
//
// Perf is the priority:
//   • every effect FPS-caps and pauses when the tab is hidden (see fx/_loop.js)
//   • heavy full-screen shaders render below native resolution (renderScale)
//   • GPU work sits off the audio thread, so real-time DSP is never starved
//   • prefers-reduced-motion forces the cheap static "ambient" canvas
//
// The choice persists in localStorage; a small switcher pill lets you compare.
import { createThreads } from './fx/threads.js';
import { createLightRays } from './fx/lightRays.js';
import { createLightning } from './fx/lightning.js';
import { createIridescence } from './fx/iridescence.js';
import { createAurora } from './fx/aurora.js';
import { createAmbient } from './fx/ambient.js';

const STORE_KEY = 'bgEffect';
// liquidChrome (full-screen WebGL shader) was the heaviest option and ran the
// GPU/fan hard even with audio off — dropped. Default to the cheap static
// "ambient" canvas.
const DEFAULT = 'ambient';

function accentRgbString() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  return v || '240,180,41';
}
function accent01() {
  return accentRgbString().split(',').map(n => parseFloat(n) / 255);
}

// label + factory + presentation (container opacity / transform) per effect.
const REGISTRY = {
  threads:      { label: 'Threads',       opacity: 0.9,  make: c => createThreads(c, { accent: accent01() }) },
  lightRays:    { label: 'Light Rays',    opacity: 0.8,  make: c => createLightRays(c, { accent: accent01() }) },
  lightning:    { label: 'Lightning',     opacity: 0.6,  make: c => createLightning(c, { hue: 40 }) },
  aurora:       { label: 'Aurora',        opacity: 0.55, transform: 'scaleY(-1)', make: c => createAurora(c, {}) },
  iridescence:  { label: 'Iridescence',   opacity: 0.5,  make: c => createIridescence(c, { accent: accent01() }) },
  ambient:      { label: 'Ambient',       opacity: 1,    make: c => createAmbient(c, { accentRgb: accentRgbString(), reduceMotion: reduceMotion() }) },
  off:          { label: 'Off',           opacity: 0,    make: () => ({ destroy() {} }) }
};

function reduceMotion() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function initBackground() {
  const container = document.getElementById('bg-fx');
  if (!container) return;

  let current = null;
  let currentName = '';

  function mount(name) {
    if (!REGISTRY[name]) name = DEFAULT; // unknown/removed (e.g. stale 'liquidChrome') → default
    if (reduceMotion() && name !== 'off') name = 'ambient'; // accessibility: no heavy motion
    const entry = REGISTRY[name] || REGISTRY[DEFAULT];
    current?.destroy();
    container.innerHTML = '';
    container.style.opacity = String(entry.opacity);
    container.style.transform = entry.transform || 'none';

    current = entry.make(container);
    currentName = name;

    // GL context unavailable (e.g. WebGL2 Aurora on old Safari) → fall back.
    if (current && current.unavailable && name !== 'ambient') {
      mount('ambient');
      return;
    }
  }

  let saved = DEFAULT;
  try { saved = localStorage.getItem(STORE_KEY) || DEFAULT; } catch {}
  // Perf A/B (?lite): keep the render loop from ever starting, not just hidden.
  if (document.documentElement.classList.contains('perf-lite')) saved = 'off';
  mount(saved);

  // React to theme accent changes + reduced-motion toggles.
  new MutationObserver(() => mount(currentName)).observe(
    document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', () => mount(currentName));
}

initBackground();
