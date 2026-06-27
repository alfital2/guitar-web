import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/reverb.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('reverb effect', () => {
  it('has size and mix', () => {
    expect(schema.type).toBe('reverb');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['size', 'mix']));
  });
  it('builds a convolver with a generated buffer and wet/dry split', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { size: 0.5, mix: 0.12 });
    const conv = ctx.connections.find(c => c.toKind === 'convolver');
    expect(conv).toBeTruthy();
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('apply changes mix without throwing', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { size: 0.5, mix: 0.1 });
    expect(() => fx.apply({ size: 0.8, mix: 0.2 })).not.toThrow();
  });
});
