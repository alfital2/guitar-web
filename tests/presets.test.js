import { describe, it, expect } from 'vitest';
import { PRESETS, validatePreset } from '../src/presets.js';
import { registry } from '../src/effects/index.js';

describe('presets', () => {
  it('exports at least the three v1 presets', () => {
    const names = PRESETS.map(p => p.name);
    expect(names).toEqual(expect.arrayContaining(['Clean (bypass)', 'Mayer — Edge of Breakup', 'Mayer — Lead Boost']));
  });
  it('all shipped presets are valid against the registry', () => {
    for (const p of PRESETS) expect(validatePreset(p, registry)).toEqual([]);
  });
  it('flags unknown effect types', () => {
    const bad = { name: 'x', chain: [{ type: 'nope', params: {} }] };
    expect(validatePreset(bad, registry)).toContain('Unknown effect type: nope');
  });
  it('flags unknown param keys', () => {
    const bad = { name: 'x', chain: [{ type: 'reverb', params: { bogus: 1 } }] };
    expect(validatePreset(bad, registry)[0]).toMatch(/unknown param/i);
  });
});
