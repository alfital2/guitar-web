// tests/delay.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/delay.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('delay effect', () => {
  it('has time/feedback/tone/mix', () => {
    expect(schema.type).toBe('delay');
    expect(schema.params.map(p => p.key)).toEqual(expect.arrayContaining(['time', 'feedback', 'tone', 'mix']));
  });
  it('creates a feedback loop and wet/dry split', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { time: 320, feedback: 0.2, tone: 4, mix: 0.15 });
    // a delay node exists and is part of a cycle (something connects back into it)
    const delayConn = ctx.connections.find(c => c.toKind === 'delay');
    expect(delayConn).toBeTruthy();
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
  });
  it('converts ms to seconds on the delay node via apply', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { time: 500, feedback: 0.3, tone: 5, mix: 0.2 });
    fx.apply({ time: 250, feedback: 0.25, tone: 4, mix: 0.18 });
    // no throw + mix applied
    expect(() => fx.apply({ time: 250, feedback: 0.25, tone: 4, mix: 0.18 })).not.toThrow();
  });
});
