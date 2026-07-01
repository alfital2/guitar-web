// tests/new-effects.test.js — schema + graph-build smoke tests for the effects
// added on top of the original seven. Each must register a unique type, build a
// graph with input/output nodes from the fake context, and survive apply().
import { describe, it, expect } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';

import * as boost from '../src/effects/boost.js';
import * as fuzz from '../src/effects/fuzz.js';
import * as octave from '../src/effects/octave.js';
import * as tremolo from '../src/effects/tremolo.js';
import * as vibrato from '../src/effects/vibrato.js';
import * as flanger from '../src/effects/flanger.js';
import * as phaser from '../src/effects/phaser.js';
import * as ringmod from '../src/effects/ringmod.js';
import * as autowah from '../src/effects/autowah.js';
import * as gate from '../src/effects/gate.js';
import * as wah from '../src/effects/wah.js';
import * as tapeEcho from '../src/effects/tape-echo.js';
import * as pingpong from '../src/effects/pingpong.js';
import * as widener from '../src/effects/widener.js';
import * as limiter from '../src/effects/limiter.js';
import * as autopan from '../src/effects/autopan.js';
import * as rotary from '../src/effects/rotary.js';

const MODS = { boost, fuzz, octave, tremolo, vibrato, flanger, phaser, ringmod,
  autowah, gate, wah, 'tape-echo': tapeEcho, pingpong, widener, limiter, autopan, rotary };

describe('expanded effects library', () => {
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

  for (const [key, m] of Object.entries(MODS)) {
    it(`${key}: builds a graph and applies defaults without throwing`, () => {
      const ctx = new FakeAudioContext();
      const params = Object.fromEntries(m.schema.params.map(p => [p.key, p.default]));
      const fx = create(m, ctx, params);
      expect(fx.input).toBeTruthy();
      expect(fx.output).toBeTruthy();
      // Single-node effects (e.g. limiter) wire input===output with no internal edges.
      if (fx.input !== fx.output) expect(ctx.connections.length).toBeGreaterThan(0);
      // re-apply with min and max extremes to exercise the param maths
      const lo = Object.fromEntries(m.schema.params.map(p => [p.key, p.min]));
      const hi = Object.fromEntries(m.schema.params.map(p => [p.key, p.max]));
      expect(() => { fx.apply(lo); fx.apply(hi); }).not.toThrow();
      // Teardown contract: any effect that started a source must return a
      // destroy() that stops every start()ed oscillator/ConstantSource.
      if (ctx.oscStarts || ctx.constStarts) expect(fx.destroy).toBeTypeOf('function');
      if (fx.destroy) {
        expect(() => fx.destroy()).not.toThrow();
        expect(ctx.oscStops || 0).toBe(ctx.oscStarts || 0);
        expect(ctx.constStops || 0).toBe(ctx.constStarts || 0);
      }
    });
  }

  // apply() receives the FULL param object on any knob change (engine.setParam),
  // so WaveShaper effects must rebuild their Float32Array curve only when the
  // curve's own source param moved — not on every unrelated knob drag.
  describe('WaveShaper curve rebuild guards', () => {
    function defaults(m) { return Object.fromEntries(m.schema.params.map(p => [p.key, p.default])); }

    it('fuzz: curve rebuilt only when fuzz changes', () => {
      const ctx = new FakeAudioContext();
      const fx = fuzz.create(ctx, defaults(fuzz));
      const shaper = ctx.nodesByKind.waveshaper[0];
      const curve = shaper.curve;
      fx.apply({ ...defaults(fuzz), tone: 9, level: 1 });
      expect(shaper.curve).toBe(curve);
      fx.apply({ ...defaults(fuzz), fuzz: 9 });
      expect(shaper.curve).not.toBe(curve);
    });

    it('octave: each of the two curves guarded on its own source param', () => {
      const ctx = new FakeAudioContext();
      const fx = octave.create(ctx, defaults(octave));
      const [rect, fuzzShaper] = ctx.nodesByKind.waveshaper; // creation order in octave.js
      const rectCurve = rect.curve, fuzzCurve = fuzzShaper.curve;
      fx.apply({ ...defaults(octave), tone: 9, level: 1 });     // unrelated knobs
      expect(rect.curve).toBe(rectCurve);
      expect(fuzzShaper.curve).toBe(fuzzCurve);
      fx.apply({ ...defaults(octave), octave: 0.2 });           // only octave moved
      expect(rect.curve).not.toBe(rectCurve);
      expect(fuzzShaper.curve).toBe(fuzzCurve);
      fx.apply({ ...defaults(octave), octave: 0.2, fuzz: 9 });  // now only fuzz moved
      expect(fuzzShaper.curve).not.toBe(fuzzCurve);
    });

    it('gate: gate curve rebuilt only when threshold changes', () => {
      const ctx = new FakeAudioContext();
      const fx = gate.create(ctx, defaults(gate));
      const gateShaper = ctx.nodesByKind.waveshaper[1]; // [0] is the static |x| rectifier
      const curve = gateShaper.curve;
      fx.apply({ ...defaults(gate), release: 9 });
      expect(gateShaper.curve).toBe(curve);
      fx.apply({ ...defaults(gate), threshold: 8 });
      expect(gateShaper.curve).not.toBe(curve);
    });
  });
});

function create(m, ctx, params) { return m.create(ctx, params); }
