// tests/engine.test.js
import { describe, it, expect } from 'vitest';
import { registry } from '../src/effects/index.js';
import { buildChain } from '../src/engine.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('registry', () => {
  it('contains all six effect types', () => {
    expect(Object.keys(registry).sort()).toEqual(['cabinet', 'compressor', 'delay', 'drive', 'eq', 'reverb']);
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
});
