import { describe, it, expect } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';

describe('FakeAudioContext', () => {
  it('records connections between nodes', () => {
    const ctx = new FakeAudioContext();
    const a = ctx.createGain(), b = ctx.createGain();
    a.connect(b);
    expect(ctx.connections).toEqual([{ from: a.id, to: b.id, fromKind: 'gain', toKind: 'gain' }]);
  });
});
