// tests/engine.test.js
import { describe, it, expect } from 'vitest';
import { registry } from '../src/effects/index.js';
import { buildChain } from '../src/engine.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('registry', () => {
  it('contains the core effect types', () => {
    // Core set must always be registered; more effects may be added over time,
    // so assert presence (superset) rather than an exact list.
    const keys = new Set(Object.keys(registry));
    for (const t of ['cabinet', 'chorus', 'compressor', 'delay', 'drive', 'eq', 'reverb']) {
      expect(keys.has(t)).toBe(true);
    }
  });
});

describe('buildChain', () => {
  const chain = [
    { type: 'compressor', params: { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 3 } },
    { type: 'eq', params: { bass: 5, mid: 6, midFreq: 750, treble: 5 } },
  ];
  it('wires input -> modules in order -> output', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, chain, registry);
    expect(g.modules).toHaveLength(2);
    expect(g.modules[0].type).toBe('compressor');
    // input connects to first module's input
    expect(ctx.connections.some(c => c.from === g.input.id && c.to === g.modules[0].input.id)).toBe(true);
    // module0 output connects to module1 input
    expect(ctx.connections.some(c => c.from === g.modules[0].output.id && c.to === g.modules[1].input.id)).toBe(true);
    // last module connects to output
    expect(ctx.connections.some(c => c.from === g.modules[1].output.id && c.to === g.output.id)).toBe(true);
  });
  it('setParam updates the module param and re-applies', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, chain, registry);
    g.setParam(1, 'bass', 8);
    expect(g.modules[1].params.bass).toBe(8);
    expect(g.modules[1].input.gain.value).toBeCloseTo(7.2); // eq bass 8 -> +7.2 dB
  });
  it('empty chain connects input straight to output', () => {
    const ctx = new FakeAudioContext();
    const g = buildChain(ctx, [], registry);
    expect(ctx.connections.some(c => c.from === g.input.id && c.to === g.output.id)).toBe(true);
  });
  it('skips a bypassed module in the signal path but keeps the chain flowing', () => {
    const ctx = new FakeAudioContext();
    const c3 = [
      { type: 'compressor', params: { threshold: -18, ratio: 2.5, attack: 0.005, release: 0.25, makeup: 3 } },
      { type: 'reverb', params: { decay: 4, mix: 0.3 }, bypassed: true },
      { type: 'eq', params: { bass: 5, mid: 6, midFreq: 750, treble: 5 } },
    ];
    const g = buildChain(ctx, c3, registry);
    expect(g.modules).toHaveLength(3); // bypassed module still built (indices aligned)
    // compressor output goes straight to eq input, hopping over the bypassed reverb
    expect(ctx.connections.some(c => c.from === g.modules[0].output.id && c.to === g.modules[2].input.id)).toBe(true);
    // nothing feeds the bypassed reverb's input
    expect(ctx.connections.some(c => c.to === g.modules[1].input.id)).toBe(false);
    // eq still reaches the output
    expect(ctx.connections.some(c => c.from === g.modules[2].output.id && c.to === g.output.id)).toBe(true);
  });
});
