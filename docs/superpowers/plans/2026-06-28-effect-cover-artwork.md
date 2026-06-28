# Effect Cover Artwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all 23 pedal effects bespoke hand-coded SVG cover art — full-bleed on the board pedals and as thumbnails in the Add Effect palette — with vibe-matched nameplate fonts.

**Architecture:** A single new module `src/chain-ui/fx-art.js` owns an injected SVG `<symbol>` sprite (one symbol per effect, recolored via `--c`) plus a per-effect font map. `pedalboard.js` references symbols by `<use>` in both the pedal card and the palette tile. `index.html` gains the full-bleed pedal CSS, the anodized rim, and the extra font families on its existing Google Fonts link.

**Tech Stack:** Vanilla JS (ES modules), inline SVG, CSS, Vitest + jsdom, Google Fonts CDN.

## Global Constraints

- Effects covered: the 23 entries in `PEDAL_TYPES` (`src/chain-ui/pedalboard.js:36-46`). Amp types (drive/eq/cabinet) are excluded.
- Art is hand-coded inline SVG only — no binary image assets.
- Symbols recolor from the host element via `var(--c)`; never hardcode the effect color inside a symbol's motif.
- One shared sprite injected once per document (`ensureFxArtSheet` is idempotent).
- Test runner: `npx vitest run` (single file: `npx vitest run tests/<file> -t '<name>'`).
- Per-effect nameplate fonts (CDN): Dirt=Bungee, Modulation=Audiowide, Time/Space=Orbitron, Tape-echo=Special Elite, Funk(wah/autowah)=Bungee Inline, Utility=Major Mono Display. Confirmed: Fuzz=Bungee.
- Commit after every task.

---

## File Structure

- **Create** `src/chain-ui/fx-art.js` — SVG sprite (`FX_ART_SHEET`), font map (`FX_FONTS`), `ensureFxArtSheet()`, `fxArtSvg(type)`.
- **Create** `tools/fx-art-gallery.html` — dev-only visual QA page rendering all 23 covers in both contexts (tile + pedal). Not shipped/imported by the app.
- **Modify** `index.html` — extend the Google Fonts `<link>` (line 9); rework `.pedal` CSS to full-bleed art + `.pedal-art`/`.pedal-scrim`/`.pedal-rim`/`.pedal-inner`; nameplate `font-family:var(--font)`; `.fx-tile .fx-art` sizing.
- **Modify** `src/chain-ui/pedalboard.js` — `buildPedal()` full-bleed restructure; palette tile uses `fxArtSvg`; set `--c`/`--font`/`--font-ls`.
- **Modify** `tests/pedalboard.test.js` — assert pedal card and tile contain `.fx-art use`.
- **Create** `tests/fx-art.test.js` — completeness guard: every `PEDAL_TYPES` type has a symbol + a `FX_FONTS` entry.

---

## Shared SVG primitives (used by every symbol)

Every `<symbol>` has `viewBox="0 0 160 120"` and `preserveAspectRatio="xMidYMid slice"` (crops to both the wide tile and the portrait pedal). The shared `<defs>` (defined once in `FX_ART_SHEET`, before the symbols) provides:

```
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
  <stop offset="0%" stop-color="#f6ecd2"/><stop offset="100%" stop-color="#e7c79a"/></linearGradient>
```

**Per-symbol recipe** (the screen-print treatment, consistent across all 23):
1. Warm base `<rect width=160 height=120 fill="#15100f"/>` (tweak hue subtly per family if desired).
2. Optional sunburst rays group at low `fill-opacity` using `fill="var(--c)"`.
3. `<rect width=160 height=120 fill="url(#fx-glow)"/>`.
4. **Off-register ink shadow** of the motif: the motif geometry in `stroke="var(--c)"` (or `fill`), `translate(2.5 3)`, drawn first.
5. The **motif** itself in `url(#fx-ink)` cream (or white), on top.
6. Grain: `<rect width=160 height=120 filter="url(#fx-grain)" opacity=".5"/>`.
7. Vignette: `<rect width=160 height=120 fill="url(#fx-vig)"/>`.

The off-register step (4) is mandatory — it is the "designed by a human" tell.

---

### Task 1: fx-art module core + Fuzz symbol + guards + gallery

**Files:**
- Create: `src/chain-ui/fx-art.js`
- Create: `tests/fx-art.test.js`
- Create: `tools/fx-art-gallery.html`

**Interfaces:**
- Produces:
  - `FX_FONTS: Record<string,{family:string, ls:string}>` — one entry per `PEDAL_TYPES` type.
  - `ensureFxArtSheet(): void` — injects the hidden sprite into `document.body` exactly once (guarded by `#fx-art-sheet` id).
  - `fxArtSvg(type:string): SVGSVGElement` — `<svg class="fx-art" viewBox="0 0 160 120"><use href="#fx-art-<type>"/></svg>`; calls `ensureFxArtSheet()`.
  - `FX_ART_SHEET: string` — the sprite markup (exported for the gallery/tests).

- [ ] **Step 1: Write the failing test** — `tests/fx-art.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { FX_FONTS, ensureFxArtSheet, fxArtSvg, FX_ART_SHEET } from '../src/chain-ui/fx-art.js';

// Mirror of PEDAL_TYPES (kept in sync by the test below).
const TYPES = ['compressor','boost','gate','fuzz','octave','wah','autowah','chorus','flanger',
  'phaser','tremolo','vibrato','autopan','rotary','ringmod','delay','tape-echo','pingpong',
  'reverb','widener','limiter','pitchshift','looper'];

beforeEach(() => { document.body.innerHTML = ''; });

describe('fx-art', () => {
  it('has a font entry for every effect type', () => {
    for (const t of TYPES) expect(FX_FONTS[t], `font for ${t}`).toBeTruthy();
  });
  it('has a <symbol> for every effect type', () => {
    for (const t of TYPES) expect(FX_ART_SHEET).toContain(`id="fx-art-${t}"`);
  });
  it('injects the sheet exactly once', () => {
    ensureFxArtSheet(); ensureFxArtSheet();
    expect(document.querySelectorAll('#fx-art-sheet')).toHaveLength(1);
  });
  it('fxArtSvg returns an svg referencing the type symbol', () => {
    const svg = fxArtSvg('fuzz');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.querySelector('use').getAttribute('href')).toBe('#fx-art-fuzz');
    expect(document.querySelector('#fx-art-sheet')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fx-art.test.js`
Expected: FAIL — cannot import from `src/chain-ui/fx-art.js` (module missing).

- [ ] **Step 3: Create `src/chain-ui/fx-art.js`** with the font map, sheet plumbing, and the proven Fuzz symbol. (Remaining symbols are added in Tasks 4-8; the `FUZZ_SYMBOL` constant and the `SYMBOLS` join show the exact shape to copy.)

```js
// src/chain-ui/fx-art.js
// Bespoke screen-print cover art for each pedal effect. One injected <symbol>
// sprite (recolored per host via --c) + a per-effect nameplate font map.

export const FX_FONTS = {
  // Dirt
  fuzz:   { family: "'Bungee', sans-serif", ls: '.02em' },
  boost:  { family: "'Bungee', sans-serif", ls: '.02em' },
  octave: { family: "'Bungee', sans-serif", ls: '.02em' },
  // Modulation
  chorus:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  flanger: { family: "'Audiowide', sans-serif", ls: '.04em' },
  phaser:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  tremolo: { family: "'Audiowide', sans-serif", ls: '.04em' },
  vibrato: { family: "'Audiowide', sans-serif", ls: '.04em' },
  rotary:  { family: "'Audiowide', sans-serif", ls: '.04em' },
  autopan: { family: "'Audiowide', sans-serif", ls: '.04em' },
  // Time / space
  delay:   { family: "'Orbitron', sans-serif", ls: '.08em' },
  reverb:  { family: "'Orbitron', sans-serif", ls: '.08em' },
  pingpong:{ family: "'Orbitron', sans-serif", ls: '.08em' },
  widener: { family: "'Orbitron', sans-serif", ls: '.08em' },
  'tape-echo': { family: "'Special Elite', monospace", ls: '.06em' },
  // Funk
  wah:     { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  autowah: { family: "'Bungee Inline', sans-serif", ls: '.02em' },
  // Utility / tech
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

// Helper wrapping a motif in the shared base+glow / grain / vignette layers.
// `rays` and `motif` are SVG fragment strings. base hue optional.
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

// --- Symbols (added per task) ---
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
```

- [ ] **Step 4: Run the guard test** — `npx vitest run tests/fx-art.test.js`. The "font entry" and "exactly once" and "fxArtSvg" tests PASS. The "symbol for every type" test FAILS (only `fuzz` exists yet). That failure is expected and is the running checklist for Tasks 4-8. Confirm only `fuzz` is reported missing-free and the rest are listed.

- [ ] **Step 5: Create `tools/fx-art-gallery.html`** — a dev page that imports `fx-art.js` as a module, injects the sheet, and renders every `PEDAL_TYPES` type in two contexts (palette tile + full-bleed pedal) using the same CSS classes as the app. Loads the Google Fonts link. Use it after each art task to eyeball results. (Mirror the structure proved in the Fuzz preview: a `.fx-grid` of tiles and a row of `.pedal` cards; set `--c` from a small color map and `--font` from `FX_FONTS`.)

- [ ] **Step 6: Commit**

```bash
git add src/chain-ui/fx-art.js tests/fx-art.test.js tools/fx-art-gallery.html
git commit -m "feat: fx-art module — sprite plumbing, font map, Fuzz cover, gallery"
```

---

### Task 2: index.html — full-bleed pedal CSS, rim, fonts

**Files:**
- Modify: `index.html` (line 9 font link; `.pedal` block ~192-218; `.fx-tile` ~254-261)

**Interfaces:**
- Consumes: nothing (pure CSS/markup). Produces the classes `pedalboard.js` will emit in Task 3: `.pedal-art`, `.pedal-scrim`, `.pedal-rim`, `.pedal-inner`, and `.pedal-name{font-family:var(--font)}`, `.fx-tile .fx-art`.

- [ ] **Step 1: Extend the Google Fonts link** at `index.html:9` — append the six families to the existing `href` (keep Inter + JetBrains Mono):

```
&family=Bungee&family=Bungee+Inline&family=Audiowide&family=Orbitron:wght@600;800&family=Special+Elite&family=Major+Mono+Display
```

- [ ] **Step 2: Replace the `.pedal` CSS block** (`index.html:192-218`) with the full-bleed structure (drop `border-top` color bar; add art/scrim/rim/inner; nameplate uses `var(--font)`). Use the exact CSS proved in the preview:

```css
.pedal{position:relative;width:132px;border-radius:13px;overflow:hidden;
  border:1px solid rgba(255,255,255,.08);
  box-shadow:0 8px 24px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08)}
.pedal-art{position:absolute;inset:0;width:100%;height:100%;z-index:0}
.pedal-scrim{position:absolute;inset:0;z-index:1;pointer-events:none;
  background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,0) 30%,rgba(0,0,0,.12) 55%,rgba(0,0,0,.62) 100%)}
.pedal-rim{position:absolute;inset:0;z-index:1;border-radius:13px;pointer-events:none;
  box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--pedal-color) 55%,transparent),inset 0 0 12px color-mix(in srgb,var(--pedal-color) 22%,transparent)}
.pedal::before,.pedal::after{content:"";position:absolute;top:8px;width:5px;height:5px;border-radius:50%;z-index:3;
  background:radial-gradient(circle at 35% 30%,#4a4a50,#0e0e11);box-shadow:0 1px 2px rgba(0,0,0,.7)}
.pedal::before{left:8px}.pedal::after{right:8px}
.pedal-inner{position:relative;z-index:2;display:flex;flex-direction:column;min-height:150px}
.pedal-name{align-self:center;margin-top:auto;
  font-family:var(--font,inherit);font-size:13px;font-weight:800;letter-spacing:var(--font-ls,.04em);
  text-transform:uppercase;line-height:1;color:rgba(255,255,255,.96);
  background:rgba(8,4,4,.62);border:1px solid rgba(0,0,0,.6);border-radius:5px;padding:4px 11px 3px;
  text-shadow:0 1px 2px rgba(0,0,0,.95);box-shadow:0 2px 6px rgba(0,0,0,.5);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.knobs{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;padding:10px 8px 8px}
.pedal-foot{height:22px;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.72));position:relative;
  display:flex;align-items:center;justify-content:center;border-top:1px solid rgba(255,255,255,.04)}
.pedal-foot::after{content:"";width:44%;height:4px;border-radius:3px;background:rgba(0,0,0,.5);box-shadow:inset 0 1px 2px rgba(0,0,0,.8)}
.pedal-led{position:absolute;top:-3px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;
  background:var(--pedal-color);box-shadow:0 0 7px var(--pedal-color),0 0 2px #fff}
```

Note: the rim/LED read `--pedal-color` (the var `pedalboard.js` already sets), while the SVG art reads `--c`. Task 3 sets both to the same value.

- [ ] **Step 3: Add tile art sizing** near `.fx-tile-dot` (`index.html:261`):

```css
.fx-tile .fx-art{width:42px;height:30px;flex:0 0 auto;border-radius:5px;display:block}
```

- [ ] **Step 4: Verify in the gallery** — open `tools/fx-art-gallery.html`; the Fuzz pedal shows full-bleed art, anodized rim (no top bar), Bungee nameplate; fonts load.

- [ ] **Step 5: Run the suite** — `npx vitest run` (CSS-only change; all green).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: full-bleed pedal art CSS, anodized rim, cover fonts"
```

---

### Task 3: pedalboard.js wiring + tests

**Files:**
- Modify: `src/chain-ui/pedalboard.js` (`buildPedal` 194-217; tile loop 328-336; import at top)
- Modify: `tests/pedalboard.test.js`

**Interfaces:**
- Consumes: `fxArtSvg`, `FX_FONTS`, `ensureFxArtSheet` from `./fx-art.js`; CSS classes from Task 2.
- Produces: each `.pedal` contains `.pedal-art use[href="#fx-art-<type>"]` and `.pedal-inner`; each `.fx-tile` contains `.fx-art use[...]`.

- [ ] **Step 1: Add failing test** — in `tests/pedalboard.test.js` `describe('renderPedalboard')`:

```js
it('renders cover art on a pedal card and sets its font', () => {
  const el = document.createElement('div');
  renderPedalboard(el, units, noop);
  const pedal = el.querySelector('.pedal');
  expect(pedal.querySelector('.pedal-art use').getAttribute('href')).toBe('#fx-art-compressor');
  expect(pedal.querySelector('.pedal-inner .pedal-name')).toBeTruthy();
  expect(pedal.style.getPropertyValue('--font')).toContain('Major Mono');
});
it('renders cover art thumbnails in the palette tiles', () => {
  const el = document.createElement('div');
  renderPedalboard(el, units, noop);
  el.querySelector('.pedal-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const tile = document.querySelector('.fx-tile[data-type="reverb"]');
  expect(tile.querySelector('.fx-art use').getAttribute('href')).toBe('#fx-art-reverb');
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/pedalboard.test.js -t 'cover art'`. Expected: FAIL (no `.pedal-art`).

- [ ] **Step 3: Import in `pedalboard.js`** (top, after the knob import):

```js
import { fxArtSvg, FX_FONTS } from './fx-art.js';
```

- [ ] **Step 4: Rewrite `buildPedal`** (`src/chain-ui/pedalboard.js:194-217`) to full-bleed structure:

```js
function buildPedal(unit, handlers) {
  const pedal = document.createElement('div');
  pedal.className = 'pedal';
  pedal.dataset.instanceId = String(unit.instanceId);
  const color = COLORS[unit.type] ?? '#636368';
  pedal.style.setProperty('--pedal-color', color);
  pedal.style.setProperty('--c', color);
  const font = FX_FONTS[unit.type];
  if (font) { pedal.style.setProperty('--font', font.family); pedal.style.setProperty('--font-ls', font.ls); }

  const art = fxArtSvg(unit.type);
  art.classList.add('pedal-art');
  const scrim = document.createElement('div'); scrim.className = 'pedal-scrim';
  const rim = document.createElement('div'); rim.className = 'pedal-rim';

  const inner = document.createElement('div');
  inner.className = 'pedal-inner';

  const plate = document.createElement('div');
  plate.className = 'pedal-name'; plate.textContent = unit.schema.label;
  plate.dataset.dragHandle = 'true';

  const knobs = document.createElement('div');
  knobs.className = 'knobs';
  for (const p of unit.schema.params) {
    const { el } = createKnob(p, unit.params[p.key] ?? p.default, (v) => handlers.onParamChange(unit.instanceId, p.key, v), true);
    knobs.appendChild(el);
  }
  const foot = document.createElement('div');
  foot.className = 'pedal-foot';
  const led = document.createElement('div');
  led.className = 'pedal-led';
  foot.appendChild(led);

  inner.append(plate, knobs, foot);
  pedal.append(art, scrim, rim, inner);
  return { pedal, plate };
}
```

(The drag handle is still `plate` (`.pedal-name`), so `enableDrag` is unchanged.)

- [ ] **Step 5: Update the palette tile loop** (`src/chain-ui/pedalboard.js:328-336`) to use art + font:

```js
  for (const [type, label] of PEDAL_TYPES) {
    const tile = document.createElement('button');
    tile.className = 'fx-tile'; tile.type = 'button'; tile.dataset.type = type;
    tile.style.setProperty('--pedal-color', COLORS[type] ?? '#636368');
    tile.style.setProperty('--c', COLORS[type] ?? '#636368');
    const font = FX_FONTS[type];
    if (font) tile.style.setProperty('--font', font.family);
    tile.appendChild(fxArtSvg(type));
    const span = document.createElement('span');
    span.className = 'fx-tile-label'; span.textContent = label;
    tile.appendChild(span);
    attachTileDrag(tile, type, label, handlers, getBoard, close);
    grid.appendChild(tile);
  }
```

- [ ] **Step 6: Run tests** — `npx vitest run`. Expected: all PASS (the new ones + the existing card/anchor/tile tests, which key off `data-type`/`.pedal`/`.pedal-name`).

- [ ] **Step 7: Visual check** — run the app (`npm run dev` or the project's serve command); confirm the board pedals show full art and the Add Effect window shows thumbnails. Only Fuzz has real art yet; the other 22 reference not-yet-defined symbols and render empty (transparent) — expected until Tasks 4-8.

- [ ] **Step 8: Commit**

```bash
git add src/chain-ui/pedalboard.js tests/pedalboard.test.js
git commit -m "feat: wire cover art + vibe fonts into pedals and palette tiles"
```

---

### Tasks 4-8: The 23 cover motifs

Each task adds its symbols to `src/chain-ui/fx-art.js`: define a `const` per effect via `scene(...)` following the **per-symbol recipe**, append it to the `SYMBOLS` array, then verify in `tools/fx-art-gallery.html` and re-run `npx vitest run tests/fx-art.test.js` (the "symbol for every type" failures shrink as you go). Motif geometry is specified per effect; tune stroke widths/paths against the live gallery render (visual work — exact path numbers are finalized at the keyboard, but each motif's construction is fully specified below). Every motif MUST include the off-register `var(--c)` shadow layer.

#### Task 4: Dirt family (boost, octave) — Fuzz already done

**Files:** Modify `src/chain-ui/fx-art.js`; verify against gallery.

- [ ] **boost** — rising staircase of bars left→right (5 bars, increasing height) topped by an up-chevron burst; cream bars over `var(--c)` off-register copy; faint `SUNBURST`. Base `#1a1206`.
- [ ] **octave** — two clipped square-waves stacked an octave apart (a tall one + a half-wavelength one inside), cream over off-register; sunburst. Base `#1a0c12`.
- [ ] Append `BOOST, OCTAVE` to `SYMBOLS`. Verify gallery; `npx vitest run tests/fx-art.test.js`.
- [ ] Commit: `feat: dirt covers — boost, octave`

#### Task 5: Modulation family (chorus, flanger, phaser, tremolo, vibrato, rotary, autopan)

**Files:** Modify `src/chain-ui/fx-art.js`; verify against gallery.

- [ ] **chorus** — three horizontal sine waves, slightly phase-offset & vertically stacked, the rear two tinted `var(--c)` (the off-register shimmer is literal here). Base `#0c1620`.
- [ ] **flanger** — a fan of nested swooping arcs (comb-filter "jet" sweep) emanating from the left; cream arcs over `var(--c)` ghost. Base `#10101c`.
- [ ] **phaser** — two interlocking S-curves crossing at center with 3 sweeping notch ticks; cream over off-register. Base `#150c1a`.
- [ ] **tremolo** — a row of vertical bars of pulsing height following a sine envelope (amplitude throb); cream bars + `var(--c)` envelope line. Base `#0a1620`.
- [ ] **vibrato** — one bold sinuous wavy line (pitch wobble) with a faint duplicate offset; cream over `var(--c)`. Base `#0a1a1e`.
- [ ] **rotary** — a Leslie horn: a rounded speaker drum with two curved motion-blur arcs implying spin; cream drum over `var(--c)` blur. Base `#1a140c`.
- [ ] **autopan** — a dot mid-arc between two speaker trapezoids (L/R) with a dashed pan path; cream speakers + dot, `var(--c)` path. Base `#08191a`.
- [ ] Append all seven to `SYMBOLS`. Verify gallery; `npx vitest run tests/fx-art.test.js`.
- [ ] Commit: `feat: modulation covers — chorus, flanger, phaser, tremolo, vibrato, rotary, autopan`

#### Task 6: Time/Space family (delay, reverb, tape-echo, pingpong, widener)

**Files:** Modify `src/chain-ui/fx-art.js`; verify against gallery.

- [ ] **delay** — a transient spike followed by 4 echo bars of decreasing height/opacity to the right; cream over `var(--c)` ghost. Base `#1a1606`.
- [ ] **reverb** — 4 concentric expanding ring arcs from a low source point (cathedral space); cream rings over `var(--c)` offset rings. Base `#1a0810`.
- [ ] **tape-echo** — two tape reels (circles + hubs) joined by a tape path that warbles; cream reels over `var(--c)`; slight wow/flutter wobble in the tape line. Base `#171206`.
- [ ] **pingpong** — a zig-zag bouncing path between top-L and bottom-R walls with a dot at a vertex; cream path/dot over `var(--c)`. Base `#1a1408`.
- [ ] **widener** — a center line with two pairs of chevrons pushing outward L/R (stereo expand); cream chevrons over `var(--c)`. Base `#0e0c1c`.
- [ ] Append all five to `SYMBOLS`. Verify gallery; `npx vitest run tests/fx-art.test.js`.
- [ ] Commit: `feat: time/space covers — delay, reverb, tape-echo, pingpong, widener`

#### Task 7: Funk family (wah, autowah)

**Files:** Modify `src/chain-ui/fx-art.js`; verify against gallery.

- [ ] **wah** — a rocker-pedal silhouette (treadle wedge, tilted) with a sweeping resonant-peak curve above it; cream pedal over `var(--c)` peak. Base `#1a1606`.
- [ ] **autowah** — a resonant formant bump with an auto/refresh loop arrow circling it (envelope auto-sweep); cream over `var(--c)`. Base `#0a1a0c`.
- [ ] Append `WAH, AUTOWAH` to `SYMBOLS`. Verify gallery; `npx vitest run tests/fx-art.test.js`.
- [ ] Commit: `feat: funk covers — wah, autowah`

#### Task 8: Utility/tech family (compressor, gate, limiter, pitchshift, looper, ringmod)

**Files:** Modify `src/chain-ui/fx-art.js`; verify against gallery.

- [ ] **compressor** — a waveform squeezed by two converging clamp bars (arrows pointing in, top+bottom); cream wave + bars over `var(--c)`. Base `#08121c`.
- [ ] **gate** — a waveform that hard-cuts to a flat silent line at a threshold, with a portcullis/gate tick; cream over `var(--c)`. Base `#141416`.
- [ ] **limiter** — peaks clipped flat against a hard horizontal ceiling line (brick wall); cream waveform + red ceiling `var(--c)`. Base `#08121c`.
- [ ] **pitchshift** — a stepped pitch ladder with up & down arrows (note shifted by steps); cream notes/steps over `var(--c)`. Base `#1a0810`.
- [ ] **looper** — two circular loop arrows (cycle) with a small layered-loop stack at center; cream over `var(--c)`. Base `#0a1a0e`.
- [ ] **ringmod** — two intersecting carrier circles with metallic sideband ticks radiating (multiplication ring); cream rings over `var(--c)`. Base `#16140c`.
- [ ] Append all six to `SYMBOLS`. Verify gallery; `npx vitest run tests/fx-art.test.js` — now ALL green (every type has a symbol).
- [ ] Commit: `feat: utility covers — compressor, gate, limiter, pitchshift, looper, ringmod`

---

### Task 9: Final integration + visual QA + story close

**Files:** none new (verification + polish only).

- [ ] **Step 1:** Run the full suite — `npx vitest run`. Expected: all PASS, including `tests/fx-art.test.js` "symbol for every type".
- [ ] **Step 2:** Open `tools/fx-art-gallery.html` — confirm all 23 read clearly as both a 42×30 tile thumbnail AND a full-bleed pedal (portrait crop). Fix any motif that's illegible when cropped (the nameplate must not collide with the busiest art band — adjust the motif's vertical placement, not the scrim).
- [ ] **Step 3:** Run the app; open the Add Effect window, add several effects, drag-reorder, delete. Confirm art renders, fonts load, rim shows, no console errors, drag still works (handle = `.pedal-name`).
- [ ] **Step 4:** Self-review for contrast/legibility: every nameplate readable over its art; every LED/rim color matches the effect.
- [ ] **Step 5:** Commit any polish: `git commit -am "polish: legibility pass across all 23 covers"`.
- [ ] **Step 6:** Mark the story done: `~/.maestro/maestro-board.sh story status 1c9b714f done`.

---

## Self-Review

**Spec coverage:** palette thumbnails (Tasks 1,3), full-bleed board art (Tasks 2,3), all 23 motifs (Tasks 1,4-8), screen-print treatment + off-register (shared recipe, every task), anodized rim / no top bar (Task 2), per-vibe fonts incl. Fuzz=Bungee (Tasks 1-3), CDN fonts (Task 2), completeness guard test (Task 1), no amp art (Global Constraints). ✓

**Placeholders:** motif geometry is described, not pre-coded, by design (visual tuning at the keyboard against the gallery) — but each construction is fully specified and the guard test enforces completeness. Scaffold/CSS/wiring steps contain complete code. ✓

**Type consistency:** `fxArtSvg`, `FX_FONTS`, `ensureFxArtSheet`, `FX_ART_SHEET` names consistent across Tasks 1/3 and tests; symbol ids `fx-art-<type>` consistent; pedal sets both `--c` (art) and `--pedal-color` (rim/LED). ✓
