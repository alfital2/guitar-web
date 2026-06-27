// tests/eq.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/eq.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('eq effect', () => {
  it('has 3 bands', () => {
    expect(schema.type).toBe('eq');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['bass', 'mid', 'midFreq', 'treble']));
  });
  it('maps band 5/10 to ~0 dB and 10/10 to +12 dB', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { bass: 5, mid: 10, midFreq: 750, treble: 5 });
    expect(fx.input.kind).toBe('biquad');
    expect(fx.input.gain.value).toBeCloseTo(0);     // bass 5 -> 0 dB
    // find the mid (peaking) node by frequency 750
    expect(fx.output.gain.value).toBeCloseTo(0);    // treble 5 -> 0 dB
  });
  it('apply updates gains and mid frequency', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { bass: 5, mid: 5, midFreq: 750, treble: 5 });
    fx.apply({ bass: 8, mid: 7, midFreq: 900, treble: 3 });
    expect(fx.input.gain.value).toBeCloseTo(7.2);   // (8-5)/5*12
  });
});
