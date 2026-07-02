// tests/famous-effects.test.js — schema + graph-build tests for the six
// "famous effects" added 2026-07-02 (acoustic sim, distortion, harmonizer,
// uni-vibe, spring reverb, whammy). Mirrors new-effects.test.js: unique
// well-formed schema, graph builds from the fake context, apply() survives
// param extremes, and the destroy() teardown contract for every effect that
// starts a source (or holds a worklet node alive).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';

import * as acousticsim from '../src/effects/acousticsim.js';
import * as distortion from '../src/effects/distortion.js';
import * as harmonizer from '../src/effects/harmonizer.js';
import * as univibe from '../src/effects/univibe.js';
import * as springverb from '../src/effects/springverb.js';
import * as whammy from '../src/effects/whammy.js';

const MODS = { acousticsim, distortion, harmonizer, univibe, springverb, whammy };
const defaults = (m) => Object.fromEntries(m.schema.params.map((p) => [p.key, p.default]));

// harmonizer/whammy construct `new AudioWorkletNode(ctx, 'pitchshift-processor')`
// — stub the global with a fake that records param writes and port messages,
// and interops with FakeAudioContext's connection bookkeeping.
class FakeWorkletNode {
  constructor(ctx, name) {
    this.kind = 'worklet'; this.name = name; this.ctx = ctx; this.id = ctx._nextId++;
    (ctx.nodesByKind.worklet ||= []).push(this);
    const store = new Map();
    this.parameters = {
      get(key) {
        if (!store.has(key)) store.set(key, {
          value: 0, targetCalls: [],
          setTargetAtTime(v, t, tc) { this.value = v; this.targetCalls.push({ v, t, tc }); },
        });
        return store.get(key);
      },
    };
    this.messages = [];
    this.port = { postMessage: (m) => this.messages.push(m) };
  }
  connect(node) { this.ctx.connections.push({ from: this.id, to: node.id, fromKind: this.kind, toKind: node.kind }); return node; }
  disconnect() { this.ctx.connections = this.ctx.connections.filter((c) => c.from !== this.id); }
}

let realWorkletNode;
beforeAll(() => { realWorkletNode = globalThis.AudioWorkletNode; globalThis.AudioWorkletNode = FakeWorkletNode; });
afterAll(() => { globalThis.AudioWorkletNode = realWorkletNode; });

describe('famous effects (2026-07-02)', () => {
  it('registers a unique, well-formed schema per effect', () => {
    const types = new Set();
    for (const [key, m] of Object.entries(MODS)) {
      expect(m.schema.type).toBe(key);
      expect(m.schema.label).toBeTruthy();
      expect(m.schema.params.length).toBeGreaterThan(0);
      for (const p of m.schema.params) {
        expect(p).toHaveProperty('key');
        expect(p.min).toBeLessThanOrEqual(p.default);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
      expect(types.has(m.schema.type)).toBe(false);
      types.add(m.schema.type);
    }
  });

  it('exposes the specified params per effect', () => {
    const keys = (m) => m.schema.params.map((p) => p.key);
    expect(keys(acousticsim)).toEqual(['body', 'air', 'level']);
    expect(keys(distortion)).toEqual(['dist', 'tone', 'level']);
    expect(keys(harmonizer)).toEqual(['interval', 'mix', 'level']);
    expect(keys(univibe)).toEqual(['speed', 'intensity', 'mix']);
    expect(keys(springverb)).toEqual(['tension', 'decay', 'mix']);
    expect(keys(whammy)).toEqual(['bend', 'range', 'mix']);
  });

  for (const [key, m] of Object.entries(MODS)) {
    it(`${key}: builds a graph and applies defaults + extremes without throwing`, () => {
      const ctx = new FakeAudioContext();
      const fx = m.create(ctx, defaults(m));
      expect(fx.input).toBeTruthy();
      expect(fx.output).toBeTruthy();
      if (fx.input !== fx.output) expect(ctx.connections.length).toBeGreaterThan(0);
      const lo = Object.fromEntries(m.schema.params.map((p) => [p.key, p.min]));
      const hi = Object.fromEntries(m.schema.params.map((p) => [p.key, p.max]));
      expect(() => { fx.apply(lo); fx.apply(hi); }).not.toThrow();
      // Teardown contract: started sources must all be stopped by destroy().
      if (ctx.oscStarts || ctx.constStarts) expect(fx.destroy).toBeTypeOf('function');
      if (fx.destroy) {
        expect(() => fx.destroy()).not.toThrow();
        expect(ctx.oscStops || 0).toBe(ctx.oscStarts || 0);
        expect(ctx.constStops || 0).toBe(ctx.constStarts || 0);
      }
    });
  }

  it('distortion: clip curve rebuilt only when dist changes', () => {
    const ctx = new FakeAudioContext();
    const fx = distortion.create(ctx, defaults(distortion));
    const shaper = ctx.nodesByKind.waveshaper[0];
    const curve = shaper.curve;
    fx.apply({ ...defaults(distortion), tone: 9, level: 1 });
    expect(shaper.curve).toBe(curve);
    fx.apply({ ...defaults(distortion), dist: 9 });
    expect(shaper.curve).not.toBe(curve);
  });

  it('springverb: impulse rebuilt on tension/decay, not on mix', () => {
    const ctx = new FakeAudioContext();
    const fx = springverb.create(ctx, defaults(springverb));
    const conv = ctx.nodesByKind.convolver[0];
    const buf = conv.buffer;
    expect(buf).toBeTruthy();
    fx.apply({ ...defaults(springverb), mix: 0.9 });
    expect(conv.buffer).toBe(buf);
    fx.apply({ ...defaults(springverb), tension: 9 });
    expect(conv.buffer).not.toBe(buf);
    const buf2 = conv.buffer;
    fx.apply({ ...defaults(springverb), tension: 9, decay: 9 });
    expect(conv.buffer).not.toBe(buf2);
  });

  it('harmonizer: worklet voice is 100% wet internally; the Mix knob drives the parallel wet gain', () => {
    const ctx = new FakeAudioContext();
    const fx = harmonizer.create(ctx, { interval: 7, mix: 0.5, level: 5 });
    const voice = ctx.nodesByKind.worklet[0];
    expect(voice.parameters.get('mix').value).toBe(1);
    expect(voice.parameters.get('semitones').value).toBe(7);
    // dry path connects input directly to output (untouched dry voice)
    expect(ctx.connections.some((c) => c.fromKind === 'gain' && c.toKind === 'gain')).toBe(true);
    fx.destroy();
    expect(voice.messages).toContainEqual({ type: 'destroy' });
  });

  it('whammy: bend maps 0..10 -> 0..range semitones and later applies glide via setTargetAtTime', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 0;
    const fx = whammy.create(ctx, { bend: 10, range: 12, mix: 1 });
    const node = ctx.nodesByKind.worklet[0];
    const st = node.parameters.get('semitones');
    expect(st.value).toBe(12);              // initial apply sets directly
    expect(st.targetCalls).toHaveLength(0);
    fx.apply({ bend: 5, range: 12, mix: 1 });
    expect(st.targetCalls).toHaveLength(1); // knob moves are smoothed
    expect(st.value).toBe(6);
    fx.apply({ bend: 5, range: 24, mix: 1 });
    expect(st.value).toBe(12);
    fx.destroy();
    expect(node.messages).toContainEqual({ type: 'destroy' });
  });

  it('univibe: 4 staggered all-pass stages swept by ONE unipolar LFO (sweep can never go negative)', () => {
    const ctx = new FakeAudioContext();
    univibe.create(ctx, { speed: 3, intensity: 10, mix: 0.5 });
    const allpasses = (ctx.nodesByKind.biquad || []).filter((b) => b.type === 'allpass');
    expect(allpasses).toHaveLength(4);
    // staggered centers: every stage's base (sweep floor) is unique and > 0
    const bases = allpasses.map((b) => b.frequency.value);
    expect(new Set(bases).size).toBe(4);
    for (const base of bases) expect(base).toBeGreaterThan(0);
    // ONE LFO oscillator; unipolarity = osc scaled to ±0.5 plus a +0.5 constant
    // offset, so the shared LFO signal ∈ [0, 1] and the minimum added sweep is
    // 0 — frequency never drops below the positive base, even at max intensity
    // (the same clamping-bug class the 2026-07-01 flanger fix addressed).
    expect(ctx.nodesByKind.oscillator).toHaveLength(1);
    expect(ctx.nodesByKind.constant[0].offset.value).toBe(0.5);
    const osc = ctx.nodesByKind.oscillator[0];
    const oscConn = ctx.connections.find((c) => c.from === osc.id);
    const oscHalf = (ctx.nodesByKind.gain || []).find((g) => g.id === oscConn.to);
    expect(oscHalf.gain.value).toBe(0.5);
  });
});
