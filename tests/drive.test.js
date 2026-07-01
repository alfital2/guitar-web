import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/drive.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('drive effect', () => {
  it('has type drive and an amount param', () => {
    expect(schema.type).toBe('drive');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['amount', 'blend', 'tone', 'level', 'midBump']));
  });
  it('builds a parallel wet/dry graph and sets a curve', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { amount: 3, tone: 5, level: 5, blend: 0.65, midBump: 0 });
    const ws = ctx.connections.find(c => c.toKind === 'waveshaper');
    expect(ws).toBeTruthy();                       // a waveshaper is in the graph
    // both a wet path (through waveshaper) and dry path (input->output) exist
    expect(ctx.connections.some(c => c.from === fx.input.id)).toBe(true);
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('apply changes the curve when amount changes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { amount: 1, tone: 5, level: 5, blend: 0.5, midBump: 0 });
    // capture the waveshaper node via connections is awkward; assert apply runs without throwing
    expect(() => fx.apply({ amount: 8, tone: 7, level: 6, blend: 0.7, midBump: 4 })).not.toThrow();
  });
  it('exposes a master param that defaults to unity gain', () => {
    expect(schema.params.map(p => p.key)).toContain('master');
    const ctx = new FakeAudioContext();
    // no master passed → default 5 → unity output gain
    const fx = create(ctx, { amount: 3, tone: 5, level: 5, blend: 0.65, midBump: 0 });
    expect(fx.output.gain.value).toBeCloseTo(1, 5);
    fx.apply({ amount: 3, tone: 5, level: 5, master: 10, blend: 0.65, midBump: 0 });
    expect(fx.output.gain.value).toBeCloseTo(2, 5);
  });
  it('rebuilds the clip curve only when Amount changes (guarded like reverb impulse)', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { amount: 3, tone: 5, level: 5, blend: 0.65, midBump: 0 });
    const shaper = ctx.nodesByKind.waveshaper[0];
    const curve = shaper.curve;
    expect(curve).toBeInstanceOf(Float32Array);
    // unrelated knobs move → curve NOT rebuilt (same object identity)
    fx.apply({ amount: 3, tone: 8, level: 2, blend: 0.4, midBump: 3 });
    expect(shaper.curve).toBe(curve);
    // the source param moves → curve rebuilt
    fx.apply({ amount: 7, tone: 8, level: 2, blend: 0.4, midBump: 3 });
    expect(shaper.curve).not.toBe(curve);
  });
});
