// tests/neuralamp-registry.test.js — Task 3: neuralamp is registered as an
// effect AND treated as a locked amp-head type by the pure chain model.
import { describe, it, expect } from 'vitest';
import { registry } from '../src/effects/index.js';
import { MODELS } from '../src/effects/neuralamp.js';
import { fromPreset, ampBounds, move } from '../src/chain-state.js';

describe('neuralamp registration (src/effects/index.js)', () => {
  it('exposes registry.neuralamp with a schema and a create function', () => {
    const def = registry['neuralamp'];
    expect(def).toBeTruthy();
    expect(def.schema.type).toBe('neuralamp');
    expect(def.schema.label).toBe('Neural Amp');
    expect(typeof def.create).toBe('function');
  });
  it('schema declares the model/trim/tone-stack/level params from the contract', () => {
    const keys = registry['neuralamp'].schema.params.map((p) => p.key);
    expect(keys).toEqual(['model', 'trim', 'bass', 'mid', 'treble', 'presence', 'level']);
  });
  it('ships the model ids that map to assets/neural/<name>.nam', () => {
    expect(MODELS).toEqual(['jcm', '5153', 'deluxe', 'ac10', 'jc', 'twin', 'mig50', 'orange', 'dumble', 'ampeg']);
  });
});

describe('neuralamp is a locked amp-head type (src/chain-state.js AMP_TYPES)', () => {
  // pedal -> neuralamp(amp head) -> cabinet(amp) -> pedal
  const PRO = [
    { type: 'boost', params: {} },
    { type: 'neuralamp', params: { model: 0, trim: 5, level: 5 } },
    { type: 'cabinet', params: {} },
    { type: 'delay', params: {} },
  ];
  const build = () => fromPreset(PRO, 1);

  it('fromPreset locks the neuralamp unit', () => {
    const { chain } = build();
    expect(chain.map((u) => u.locked)).toEqual([false, true, true, false]);
  });
  it('ampBounds includes neuralamp in the contiguous amp block', () => {
    const { chain } = build();
    expect(ampBounds(chain)).toEqual({ start: 1, end: 2 });
  });
  it('move refuses to relocate the locked neuralamp head', () => {
    const { chain } = build();
    expect(move(chain, 2, 0).map((u) => u.type)).toEqual(chain.map((u) => u.type));
  });
  it('move clamps a pedal dropped inside the amp block to just before it', () => {
    const { chain } = build();
    const moved = move(chain, 4, 2); // delay dropped inside the amp block (index 2)
    // tie-break lands it at the block start (index 1), never between neuralamp & cabinet
    expect(moved.map((u) => u.type)).toEqual(['boost', 'delay', 'neuralamp', 'cabinet']);
  });
});
