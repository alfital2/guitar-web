import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/compressor.js';
import { dbToGain } from '../src/dsp.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('compressor effect', () => {
  it('exposes a schema with a stable type', () => {
    expect(schema.type).toBe('compressor');
    expect(schema.params.map(p => p.key)).toContain('ratio');
  });
  it('wires compressor -> makeup gain and applies params', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 6 });
    // input is compressor, output is makeup gain, connected internally
    expect(fx.input.kind).toBe('compressor');
    expect(fx.output.kind).toBe('gain');
    expect(ctx.connections.some(c => c.from === fx.input.id && c.to === fx.output.id)).toBe(true);
    expect(fx.input.ratio.value).toBe(2.5);
    expect(fx.input.threshold.value).toBe(-18);
    expect(fx.output.gain.value).toBeCloseTo(dbToGain(6));
  });
  it('apply updates params live', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 0 });
    fx.apply({ threshold: -30, ratio: 4, attack: 0.01, release: 0.3, makeup: 3 });
    expect(fx.input.threshold.value).toBe(-30);
    expect(fx.input.ratio.value).toBe(4);
    expect(fx.output.gain.value).toBeCloseTo(dbToGain(3));
  });
});
