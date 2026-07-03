import { describe, it, expect } from 'vitest';
import { GB_CATEGORIES, validatePreset } from '../src/presets.js';
import { registry } from '../src/effects/index.js';
import { isNeuralChain, measureLoudnessGain } from '../src/normalize.js';
import { MODELS } from '../src/effects/neuralamp.js';

describe('05 Professional category', () => {
  const pro = GB_CATEGORIES.find((c) => c.id === 'pro');

  it('exists with the "05 Professional" label and exactly 5 presets', () => {
    expect(pro).toBeTruthy();
    expect(pro.label).toBe('05 Professional');
    expect(pro.presets).toHaveLength(5);
  });

  it('every preset is a single neuralamp amp-head with a valid model index', () => {
    for (const p of pro.presets) {
      expect(p.category).toBe('pro');
      // normDb is dead: loudness is normalized at load time by the same
      // offline measurement path as every other preset (normalize.js).
      expect(p.normDb).toBeUndefined();
      expect(p.chain).toHaveLength(1);
      const node = p.chain[0];
      expect(node.type).toBe('neuralamp');
      expect(node.params.model).toBeGreaterThanOrEqual(0);
      expect(node.params.model).toBeLessThan(MODELS.length);
      expect(node.params.trim).toBe(5);
      expect(node.params.level).toBe(5);
      // Passes registry validation (neuralamp registered, only known params).
      expect(validatePreset(p, registry)).toEqual([]);
    }
  });

  it('covers all five distinct model indices 0..4', () => {
    const idx = pro.presets.map((p) => p.chain[0].params.model).sort();
    expect(idx).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('loudness normalization is unified across engines', () => {
  it('isNeuralChain detects a neuralamp node anywhere in the chain', () => {
    expect(isNeuralChain([{ type: 'neuralamp', params: {} }])).toBe(true);
    expect(isNeuralChain([{ type: 'drive', params: {} }, { type: 'neuralamp', params: {} }])).toBe(true);
    expect(isNeuralChain([{ type: 'drive', params: {} }, { type: 'reverb', params: {} }])).toBe(false);
    expect(isNeuralChain([])).toBe(false);
    expect(isNeuralChain(null)).toBe(false);
  });

  it('measureLoudnessGain treats neural chains like any other (unity under jsdom)', async () => {
    // jsdom has no OfflineAudioContext, so BOTH engines take the same safe
    // fallback (1 = unity) — neural is no longer special-cased to null.
    await expect(measureLoudnessGain([{ type: 'neuralamp', params: {} }])).resolves.toBe(1);
    await expect(measureLoudnessGain([{ type: 'drive', params: {} }])).resolves.toBe(1);
  });
});
