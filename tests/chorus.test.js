// tests/chorus.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/chorus.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('chorus effect', () => {
  it('has type chorus with rate/depth/mix', () => {
    expect(schema.type).toBe('chorus');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['rate', 'depth', 'mix']));
  });
  it('builds a modulated-delay graph, starts the LFO, and applies params', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { rate: 1.5, depth: 4, mix: 0.4 });
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
    expect(ctx.connections.some(c => c.toKind === 'delay' || c.fromKind === 'delay')).toBe(true);
    expect(ctx.connections.some(c => c.fromKind === 'oscillator')).toBe(true);
    expect(ctx.oscStarts).toBe(1);
  });
  it('apply sets mix and rate without throwing', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { rate: 1, depth: 3, mix: 0.3 });
    expect(() => fx.apply({ rate: 2, depth: 6, mix: 0.5 })).not.toThrow();
  });
  it('destroy stops the started LFO and disconnects its nodes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { rate: 1.5, depth: 4, mix: 0.4 });
    expect(ctx.oscStarts).toBe(1);
    fx.destroy();
    expect(ctx.oscStops).toBe(1);
    expect(ctx.connections.some(c => c.from === fx.input.id)).toBe(false);
    expect(ctx.connections.some(c => c.fromKind === 'oscillator')).toBe(false);
  });
});
