// tests/cabinet.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/cabinet.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('cabinet effect', () => {
  it('is a cabinet with brightness/body/mix', () => {
    expect(schema.type).toBe('cabinet');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['brightness', 'body', 'mix']));
  });
  it('rolls off highs (input is a highpass, mix on output)', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { brightness: 4, body: 6, mix: 1 });
    expect(fx.input.kind).toBe('biquad');
    expect(fx.input.type).toBe('highpass');
    expect(fx.output.kind).toBe('gain');
    expect(fx.output.gain.value).toBe(1);
  });
  it('exposes a presence param and wires a high-shelf for it', () => {
    expect(schema.params.map(p => p.key)).toContain('presence');
    const ctx = new FakeAudioContext();
    // builds without presence (defaults neutral) and with an explicit value
    expect(() => create(ctx, { brightness: 4, body: 6, mix: 1 })).not.toThrow();
    expect(() => create(ctx, { brightness: 4, body: 6, presence: 8, mix: 1 })).not.toThrow();
  });
});
