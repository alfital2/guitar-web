// tests/fx-viz.test.js — the effect-viz registry: coverage, robustness across
// param bounds, mathematical truth of the drive/EQ visualizations, and the
// shared-ticker gates (hidden tab, bypassed freeze, dead-canvas pruning).
import { describe, it, expect, afterEach } from 'vitest';
import { registry } from '../src/effects/index.js';
import {
  makeSoftClipCurve, makeHardClipCurve, makeDistortionCurve, makeRectifierCurve,
} from '../src/dsp.js';
import {
  VIZ, CURVES, registerViz, resetViz, tickViz, vizEntryCount, eqResponseDb,
} from '../src/chain-ui/fx-viz.js';

afterEach(() => resetViz());

// A permissive 2D-context stub: every method is a recording no-op, property
// sets are accepted, gradient factories return an addColorStop-able object.
function stubCtx() {
  const calls = [];
  const gradient = { addColorStop: () => {} };
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === '__calls') return calls;
      return (...args) => {
        calls.push([prop, args]);
        return String(prop).includes('Gradient') ? gradient : undefined;
      };
    },
    set: () => true,
  });
  return ctx;
}

function fakeCanvas(ctx = stubCtx(), connected = true) {
  return { isConnected: connected, clientWidth: 120, clientHeight: 80, width: 0, height: 0, getContext: () => ctx, __ctx: ctx };
}

const paramsAt = (schema, pick) =>
  Object.fromEntries(schema.params.map((p) => [p.key, pick(p)]));

const vizTypes = Object.keys(registry).filter((t) => t !== 'neuralamp');

describe('VIZ registry coverage', () => {
  it('has a draw function for every registered effect type except neuralamp', () => {
    for (const type of vizTypes) {
      expect(typeof VIZ[type], `missing viz for "${type}"`).toBe('function');
    }
  });

  it('does not viz neuralamp (it renders in the amp head, not a pedal)', () => {
    expect(VIZ.neuralamp).toBeUndefined();
  });

  for (const type of vizTypes) {
    it(`${type}: draw() runs without throwing at default, min, and max params`, () => {
      const schema = registry[type].schema;
      for (const pick of [(p) => p.default, (p) => p.min, (p) => p.max]) {
        const params = paramsAt(schema, pick);
        for (const t of [0, 1.234, 60.7]) {
          const g = stubCtx();
          expect(() => VIZ[type](g, t, params, 120, 80)).not.toThrow();
          expect(g.__calls.length).toBeGreaterThan(0); // it actually drew
        }
      }
    });
  }
});

describe('mathematically true drive-family transfer', () => {
  it('routes through the SAME dsp.js curve makers the audio uses', () => {
    expect(CURVES.makeSoftClipCurve).toBe(makeSoftClipCurve);
    expect(CURVES.makeHardClipCurve).toBe(makeHardClipCurve);
    expect(CURVES.makeDistortionCurve).toBe(makeDistortionCurve);
    expect(CURVES.makeRectifierCurve).toBe(makeRectifierCurve);
  });

  const spyCases = [
    ['drive', 'makeSoftClipCurve', { amount: 3.31, tone: 5, level: 5, master: 5, blend: 0.65, midBump: 0 }, 3.31],
    ['fuzz', 'makeHardClipCurve', { fuzz: 7.77, tone: 5, level: 4 }, 7.77],
    ['distortion', 'makeDistortionCurve', { dist: 4.44, tone: 5, level: 5 }, 4.44],
  ];
  for (const [type, maker, params, amount] of spyCases) {
    it(`${type} evaluates the real ${maker}(${amount}) WaveShaper curve`, () => {
      const orig = CURVES[maker];
      const calls = [];
      CURVES[maker] = (...a) => { calls.push(a); return orig(...a); };
      try {
        VIZ[type](stubCtx(), 0.5, params, 120, 80);
      } finally {
        CURVES[maker] = orig;
      }
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][0]).toBe(amount);
    });
  }

  it('octave evaluates the real rectifier curve', () => {
    const orig = CURVES.makeRectifierCurve;
    const calls = [];
    CURVES.makeRectifierCurve = (...a) => { calls.push(a); return orig(...a); };
    try {
      VIZ.octave(stubCtx(), 0, { octave: 0.42, fuzz: 6, tone: 6, level: 4 }, 120, 80);
    } finally {
      CURVES.makeRectifierCurve = orig;
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBe(0.42);
  });
});

describe('mathematically true EQ response', () => {
  const freqs = [60, 120, 250, 750, 1500, 3000, 6000, 10000];

  it('is flat when all bands sit at the 0dB midpoint (5)', () => {
    const resp = eqResponseDb({ bass: 5, mid: 5, midFreq: 750, treble: 5 }, freqs);
    for (const dB of resp) expect(Math.abs(dB)).toBeLessThan(0.01);
  });

  it('is non-flat with real shelf gain when bass is boosted', () => {
    const resp = eqResponseDb({ bass: 10, mid: 5, midFreq: 750, treble: 5 }, freqs);
    expect(resp[0]).toBeGreaterThan(8);           // +12dB lowshelf reaches ~+12 at 60Hz
    expect(Math.abs(resp[freqs.length - 1])).toBeLessThan(1); // top end untouched
    expect(Math.max(...resp) - Math.min(...resp)).toBeGreaterThan(6);
  });

  it('mid band cut dips at midFreq and follows the knob', () => {
    const resp = eqResponseDb({ bass: 5, mid: 0, midFreq: 750, treble: 5 }, [750]);
    expect(resp[0]).toBeLessThan(-8); // −12dB peaking cut at its center
  });
});

describe('compressor punch-up: hot vs parked', () => {
  const P = paramsAt(registry.compressor.schema, (p) => p.default);
  const callsAt = (t, params = P) => {
    const g = stubCtx();
    VIZ.compressor(g, t, params, 120, 80);
    return JSON.stringify(g.__calls);
  };

  it('parked: the same frozen clock always draws the identical frame', () => {
    expect(callsAt(1.234)).toBe(callsAt(1.234));
    expect(callsAt(0)).toBe(callsAt(0));
  });

  it('hot: an advancing clock draws clearly different frames (pump + needle kick)', () => {
    expect(callsAt(0)).not.toBe(callsAt(0.9));
    expect(callsAt(0.9)).not.toBe(callsAt(1.8));
    // even nearby clock values differ — the pump is bold, not a subtle drift
    expect(callsAt(0.4)).not.toBe(callsAt(0.55));
  });

  it('draws the meter bars, the GR needle arc and the knee-riding probe', () => {
    const g = stubCtx();
    VIZ.compressor(g, 0.5, P, 120, 80);
    const names = g.__calls.map(([m]) => m);
    expect(names.filter((m) => m === 'fillRect').length).toBeGreaterThanOrEqual(6); // tracks + levels + caps
    expect(names.filter((m) => m === 'arc').length).toBeGreaterThanOrEqual(4);      // probe + trail + gauge arc
  });

  it('the program level clamps inside the -60..0 dB plot at extreme params', () => {
    const g = stubCtx();
    VIZ.compressor(g, 0.7, { threshold: -60, ratio: 20, attack: 0.005, release: 0.25, makeup: 3 }, 120, 80);
    for (const [m, a] of g.__calls) {
      if (m === 'arc') { expect(a[0]).toBeGreaterThanOrEqual(0); expect(a[0]).toBeLessThanOrEqual(120); }
    }
  });

  it('limiter keeps the original brick-wall knee draw (only the compressor changed)', () => {
    const g = stubCtx();
    expect(() => VIZ.limiter(g, 0.5, { threshold: -6, release: 0.05 }, 120, 80)).not.toThrow();
    expect(g.__calls.length).toBeGreaterThan(0);
  });
});

describe('ticker gates and lifecycle', () => {
  const defaults = paramsAt(registry.delay.schema, (p) => p.default);

  it('does no canvas work while document.hidden', () => {
    const cv = fakeCanvas();
    registerViz(cv, 'delay', () => defaults);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    try {
      expect(tickViz(1)).toBe(0);
      expect(cv.__ctx.__calls.length).toBe(0);
    } finally {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    }
    expect(tickViz(1)).toBe(1);
    expect(cv.__ctx.__calls.length).toBeGreaterThan(0);
  });

  it('is STILL at rest: no redraws while params are unchanged', () => {
    const cv = fakeCanvas();
    registerViz(cv, 'delay', () => defaults);
    expect(tickViz(0)).toBe(1);    // first frame
    expect(tickViz(0.1)).toBe(0);  // idle — only a signature compare
    expect(tickViz(0.2)).toBe(0);
    expect(tickViz(9.9)).toBe(0);
  });

  it('tuning kicks the animation; it keeps running briefly, then eases out and parks', () => {
    const cv = fakeCanvas();
    const params = { ...defaults };
    registerViz(cv, 'delay', () => params);
    expect(tickViz(0)).toBe(1);   // first frame
    expect(tickViz(0.1)).toBe(0); // at rest
    params.time = 800;            // knob move → kick
    expect(tickViz(0.2)).toBe(1); // redraw with the new params
    expect(tickViz(0.3)).toBe(1); // still animating with NO further change (hold)
    expect(tickViz(0.7)).toBe(1);
    // after the hold the velocity decays each tick until the screen parks
    let now = 0.9, last = 1;
    for (let i = 0; i < 80 && last > 0; i++) { now += 0.1; last = tickViz(now); }
    expect(last).toBe(0);                 // parked
    expect(tickViz(now + 0.1)).toBe(0);   // and stays still
    expect(tickViz(now + 0.2)).toBe(0);
  });

  it('freezes a bypassed pedal after one static frame (even if params change)', () => {
    const cv = fakeCanvas();
    const params = { ...defaults };
    registerViz(cv, 'delay', () => params, { bypassed: true });
    expect(tickViz(1)).toBe(1);  // the single frozen frame
    expect(tickViz(2)).toBe(0);  // never redrawn
    params.time = 900;
    expect(tickViz(3)).toBe(0);
  });

  it('prunes disconnected canvases on tick (no leaks across re-renders)', () => {
    registerViz(fakeCanvas(stubCtx(), false), 'delay', () => defaults);
    expect(vizEntryCount()).toBe(1);
    tickViz(1);
    expect(vizEntryCount()).toBe(0);
  });

  it('resetViz drops every entry', () => {
    registerViz(fakeCanvas(), 'delay', () => defaults);
    registerViz(fakeCanvas(), 'chorus', () => ({ rate: 1.5, depth: 4, mix: 0.4 }));
    expect(vizEntryCount()).toBe(2);
    resetViz();
    expect(vizEntryCount()).toBe(0);
    expect(tickViz(1)).toBe(0);
  });

  it('returns false for unknown types (caller falls back to the motif)', () => {
    expect(registerViz(fakeCanvas(), 'nope', () => ({}))).toBe(false);
    expect(vizEntryCount()).toBe(0);
  });

  it('sizes the backing store device-pixel aware (capped at 2x)', () => {
    const cv = fakeCanvas();
    registerViz(cv, 'delay', () => defaults);
    tickViz(1);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    expect(cv.width).toBe(Math.round(120 * dpr));
    expect(cv.height).toBe(Math.round(80 * dpr));
  });
});
