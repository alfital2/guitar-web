import { describe, it, expect, beforeEach } from 'vitest';
import { FX_FONTS, ensureFxArtSheet, fxArtSvg, FX_ART_SHEET } from '../src/chain-ui/fx-art.js';

// Mirror of PEDAL_TYPES (kept in sync by the test below).
const TYPES = ['compressor','boost','gate','fuzz','octave','wah','autowah','chorus','flanger',
  'phaser','tremolo','vibrato','autopan','rotary','ringmod','delay','tape-echo','pingpong',
  'reverb','widener','limiter','pitchshift','looper',
  'acousticsim','distortion','harmonizer','univibe','springverb','whammy'];

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
