// tests/neural-assets.test.js
// Guards the built neural-amp engine artifacts + copied models (no browser).
// Functional wasm-in-worklet proof lives in tools/neural/derisk.mjs (Playwright).
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const asset = (p) => fileURLToPath(new URL('../assets/neural/' + p, import.meta.url));
const MODELS = ['jcm', '5153', 'deluxe', 'ac10', 'jc'];

describe('neural assets', () => {
  it('emitted nam.js + nam.wasm', () => {
    expect(existsSync(asset('nam.js'))).toBe(true);
    expect(existsSync(asset('nam.wasm'))).toBe(true);
  });

  it('nam.wasm starts with the wasm magic (\\0asm)', () => {
    const b = readFileSync(asset('nam.wasm'));
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  });

  it('nam.js is an ES6 factory exposing the C API + runtime methods', () => {
    const js = readFileSync(asset('nam.js'), 'utf8');
    expect(js).toMatch(/export default/);
    for (const fn of ['_nam_load', '_nam_reset', '_nam_process', '_nam_expected_sr', '_malloc', '_free'])
      expect(js).toContain(fn);
    expect(js).toMatch(/ccall|cwrap/);
  });

  it('ships all 5 Professional models as parseable NAM WaveNet JSON', () => {
    for (const m of MODELS) {
      const j = JSON.parse(readFileSync(asset(m + '.nam'), 'utf8'));
      expect(j).toHaveProperty('architecture', 'WaveNet');
      expect(j).toHaveProperty('weights');
    }
  });
});
