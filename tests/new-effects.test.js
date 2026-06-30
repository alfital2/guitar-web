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
    });
  }
});

function create(m, ctx, params) { return m.create(ctx, params); }
