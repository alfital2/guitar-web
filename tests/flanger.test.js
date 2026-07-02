// tests/flanger.test.js
import { describe, it, expect } from 'vitest';
import { schema, create } from '../src/effects/flanger.js';
import { FakeAudioContext } from './fake-audio-context.js';

const defaults = Object.fromEntries(schema.params.map((p) => [p.key, p.default]));

describe('flanger effect', () => {
  it('has type flanger with rate/depth/feedback/mix', () => {
    expect(schema.type).toBe('flanger');
    expect(schema.params.map((p) => p.key)).toEqual(
      expect.arrayContaining(['rate', 'depth', 'feedback', 'mix'])
    );
  });

  it('builds a modulated-delay graph, starts the LFO(s), and applies params', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { rate: 1, depth: 4, feedback: 0.3, mix: 0.5 });
    expect(fx.input.kind).toBe('gain');
    expect(fx.output.kind).toBe('gain');
    expect(ctx.connections.some((c) => c.toKind === 'delay' || c.fromKind === 'delay')).toBe(true);
    expect(ctx.connections.some((c) => c.fromKind === 'oscillator')).toBe(true);
    expect(ctx.oscStarts).toBe(1);
    // Unipolar-LFO fix adds a ConstantSourceNode offset feeding delayTime.
    expect(ctx.constStarts).toBe(1);
  });

  it('destroy stops the oscillator AND the constant-source offset, disconnects all nodes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, defaults);
    expect(ctx.oscStarts).toBe(1);
    expect(ctx.constStarts).toBe(1);
    fx.destroy();
    expect(ctx.oscStops).toBe(1);
    expect(ctx.constStops).toBe(1);
    expect(ctx.connections.some((c) => c.from === fx.input.id)).toBe(false);
    expect(ctx.connections.some((c) => c.fromKind === 'oscillator')).toBe(false);
  });

  // Regression test for docs/code-review-2026-07-01.md finding #9: the OLD
  // bipolar LFO (base 0.002s + up to ±0.003s swing) drove delayTime negative
  // at Depth > ~6.7 (Web Audio silently clamps to 0 -> asymmetric, distorted
  // sweep). The fix drives delayTime via a unipolar offset+amplitude pair
  // (ConstantSourceNode + Gain, mirroring phaser.js's lfoOffset pattern) so
  // the modulated value never goes below a small positive floor.
  it('keeps modulated delayTime strictly positive across the full Depth range (0..10)', () => {
    for (const depth of [0, 1, 2.5, 5, 6.7, 8, 10]) {
      const ctx = new FakeAudioContext();
      const fx = create(ctx, { ...defaults, depth });

      const delayNode = ctx.nodesByKind.delay[0];
      // The ConstantSourceNode is the only node feeding an AudioParam target
      // (AudioParams have no .id, unlike AudioNodes) rather than another node.
      const constantSource = ctx.nodesByKind.constant.find((n) =>
        ctx.connections.some((c) => c.from === n.id && c.to === undefined)
      );
      // The LFO gain is the gain node feeding that same AudioParam target.
      const lfoGain = ctx.nodesByKind.gain.find((n) =>
        ctx.connections.some((c) => c.from === n.id && c.to === undefined)
      );

      expect(constantSource).toBeTruthy();
      expect(lfoGain).toBeTruthy();

      // Static base contribution from delay.delayTime.value (should be 0 —
      // the base now lives entirely in the ConstantSourceNode offset).
      const staticBase = delayNode.delayTime.value;
      const swingHalf = lfoGain.gain.value;
      const offset = constantSource.offset.value;
      const min = staticBase + offset - swingHalf;
      const max = staticBase + offset + swingHalf;

      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThanOrEqual(min); // depth=0 -> no swing, min === max
    }
  });

  it('at the default Depth (5), the sweep width is close to the pre-fix ~3ms width', () => {
    const ctx = new FakeAudioContext();
    create(ctx, defaults);
    const lfoGain = ctx.nodesByKind.gain.find((n) =>
      ctx.connections.some((c) => c.from === n.id && c.to === undefined)
    );
    const widthMs = lfoGain.gain.value * 2 * 1000; // peak-to-peak, in ms
    expect(widthMs).toBeCloseTo(3, 0); // ~3ms, same audible character as before
  });

  it('apply sets mix/feedback/rate without throwing', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, defaults);
    expect(() => fx.apply({ rate: 2, depth: 8, feedback: 0.7, mix: 0.8 })).not.toThrow();
  });
});
