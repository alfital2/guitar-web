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
});
