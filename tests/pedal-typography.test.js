// tests/pedal-typography.test.js
// Guards the pedal typography design system:
//   1. every addable pedal's NAME ink clears WCAG 4.5:1 against the faceplate
//      surface it renders on (kills the color-melt cases),
//   2. every type has a personality name-font in the 10–17px range,
//   3. knob labels use ONE clean condensed sans everywhere (no personality at 8px),
//   4. the Google Font load stays within a 10-family budget (Pacifico kept).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FX_TYPE, nameInk, nameSurface, contrastRatio } from '../src/chain-ui/fx-art.js';
import { renderPedalboard } from '../src/chain-ui/pedalboard.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(HERE, '..', 'index.html'), 'utf8');

// Mirror of PEDAL_TYPES in pedalboard.js — the board's addable pedals. A drift
// guard below asserts this matches the effects window exactly.
const PEDAL_TYPES = [
  'compressor', 'boost', 'gate', 'distortion', 'fuzz', 'octave', 'acousticsim',
  'wah', 'autowah', 'chorus', 'flanger', 'phaser', 'univibe', 'tremolo', 'vibrato',
  'autopan', 'rotary', 'ringmod', 'delay', 'tape-echo', 'pingpong', 'springverb',
  'widener', 'limiter', 'pitchshift', 'harmonizer', 'whammy', 'looper',
];

describe('pedal typography — name contrast (WCAG ≥ 4.5:1)', () => {
  for (const t of PEDAL_TYPES) {
    it(`${t}: name ink is legible on its faceplate`, () => {
      const ink = nameInk(t);
      const surface = nameSurface(t);
      const ratio = contrastRatio(ink, surface);
      expect(ratio, `${t}: ink ${ink} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('pedal typography — name assignments', () => {
  it('every pedal has a personality name-font sized 10–17px', () => {
    for (const t of PEDAL_TYPES) {
      const ty = FX_TYPE[t];
      expect(ty, `FX_TYPE entry for ${t}`).toBeTruthy();
      expect(ty.font, `${t} font`).toMatch(/'[^']+'/); // a real family, quoted
      expect(ty.size, `${t} size`).toBeGreaterThanOrEqual(10);
      expect(ty.size, `${t} size`).toBeLessThanOrEqual(17);
      expect(ty.dir === 'light' || ty.dir === 'dark', `${t} ink dir`).toBe(true);
    }
  });

  it('the effects window offers exactly PEDAL_TYPES (drift guard)', () => {
    const el = document.createElement('div');
    renderPedalboard(el, [], { onParamChange() {}, onAdd() {}, onRemove() {}, onMove() {} });
    el.querySelector('.pedal-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const types = [...document.querySelectorAll('.fx-tile')].map((b) => b.dataset.type);
    expect(new Set(types)).toEqual(new Set(PEDAL_TYPES));
    document.querySelectorAll('.fx-modal, .fx-modal-backdrop').forEach((n) => n.remove());
  });
});

describe('knob labels — one condensed sans everywhere', () => {
  it('knob labels use Barlow Condensed via a single uniform CSS rule', () => {
    expect(indexHtml).toMatch(/\.pedal-knob b\s*\{[^}]*'Barlow Condensed'/);
  });
  it('personality is reserved for names — FX_TYPE carries no per-effect label font', () => {
    for (const t of PEDAL_TYPES) expect(FX_TYPE[t]).not.toHaveProperty('labelFont');
  });
});

describe('font load budget', () => {
  it('loads ≤ 10 Google Font families in one link, keeping Pacifico + Barlow Condensed', () => {
    const m = indexHtml.match(/fonts\.googleapis\.com\/css2\?([^"]+)/);
    expect(m, 'google fonts <link>').toBeTruthy();
    const families = [...m[1].matchAll(/family=([^&:]+)/g)].map((x) => x[1]);
    expect(families.length, families.join(',')).toBeLessThanOrEqual(10);
    expect(families).toContain('Pacifico');
    expect(families).toContain('Barlow+Condensed');
    expect(m[1]).toContain('display=swap');
  });
});
