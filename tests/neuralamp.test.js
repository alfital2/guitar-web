// tests/neuralamp.test.js — unit spec for the neuralamp amp-head effect.
// Stubs AudioWorkletNode + fetch so the module can be exercised in jsdom with no
// real worklet/wasm. Verifies the schema/MODELS exports, the trimGain→worklet→
// levelGain graph, the 0..10→gain (unity at 5) mapping, and the wasm→wasm-ready→
// model handshake the module drives against the worklet's OUT-side messages
// (see src/effects/worklets/neural-amp-processor.js for the exact event names:
// 'wasm-ready', 'wasm-error', 'ready', 'model-error').
import { describe, it, expect, beforeAll } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';
import { schema, MODELS, create } from '../src/effects/neuralamp.js';

// A worklet node that plugs into FakeAudioContext's connection graph and records
// every port.postMessage. Registers itself on ctx.workletNodes for inspection.
// `emit(data)` simulates the worklet processor posting an OUT message back to
// the module's node.port.onmessage handler (e.g. {type:'wasm-ready'} or
// {type:'model-error', error}), the way the real AudioWorkletProcessor does.
class FakeWorkletNode {
  constructor(ctx, name, opts) {
    this.ctx = ctx; this.name = name; this.opts = opts;
    this.id = ctx._nextId++; this.kind = 'worklet';
    this.messages = [];
    this.port = {
      postMessage: (m) => this.messages.push(m),
      onmessage: null,
    };
    (ctx.workletNodes ||= []).push(this);
  }
  connect(node) {
    this.ctx.connections.push({ from: this.id, to: node.id, fromKind: this.kind, toKind: node.kind });
    return node;
  }
  disconnect() {}
  emit(data) {
    this.port.onmessage?.({ data });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeAll(() => {
  globalThis.AudioWorkletNode = FakeWorkletNode;
  globalThis.fetch = (url) => {
    const s = String(url);
    if (s.endsWith('.wasm')) {
      return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    }
    const name = s.split('/').pop().replace(/\.nam$/, ''); // e.g. "5153"
    return Promise.resolve({ text: () => Promise.resolve(JSON.stringify({ model: name })) });
  };
});

describe('neuralamp effect', () => {
  it('exposes the neuralamp schema and the 5 model ids', () => {
    expect(schema.type).toBe('neuralamp');
    expect(schema.label).toBe('Neural Amp');
    expect(schema.params.map((p) => p.key)).toEqual(['model', 'trim', 'level']);
    const model = schema.params.find((p) => p.key === 'model');
    expect([model.min, model.max, model.default, model.step]).toEqual([0, 4, 0, 1]);
    expect(MODELS).toEqual(['jcm', '5153', 'deluxe', 'ac10', 'jc']);
  });

  it('create() returns {input, output, apply} with distinct gain nodes', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    expect(typeof fx.apply).toBe('function');
    expect(fx.input).toBeTruthy();
    expect(fx.output).toBeTruthy();
    expect(fx.input).not.toBe(fx.output);
    expect(fx.input.kind).toBe('gain');   // trimGain
    expect(fx.output.kind).toBe('gain');  // levelGain
  });

  it('wires trimGain → worklet → levelGain and posts wasm on create()', async () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    const node = ctx.workletNodes[0];
    expect(node.name).toBe('neural-amp-processor');
    expect(ctx.connections).toContainEqual(
      expect.objectContaining({ from: fx.input.id, to: node.id }));
    expect(ctx.connections).toContainEqual(
      expect.objectContaining({ from: node.id, to: fx.output.id }));
    await flush();
    expect(node.messages.some((m) => m.type === 'wasm')).toBe(true);
  });

  it('maps trim/level 0..10 to gain centred on unity at 5', () => {
    const ctx = new FakeAudioContext();
    const fx = create(ctx, { model: 0, trim: 5, level: 5 });
    expect(fx.input.gain.value).toBeCloseTo(1, 6);   // trim 5 → unity
    expect(fx.output.gain.value).toBeCloseTo(1, 6);  // level 5 → unity
    fx.apply({ model: 0, trim: 10, level: 0 });
    expect(fx.input.gain.value).toBeCloseTo(Math.pow(10, 0.5), 6);   // ≈3.1623
    expect(fx.output.gain.value).toBeCloseTo(Math.pow(10, -0.5), 6); // ≈0.3162
  });

  describe('wasm → wasm-ready → model handshake', () => {
    it('does NOT post {type:"model"} before {type:"wasm-ready"} is received', async () => {
      const ctx = new FakeAudioContext();
      create(ctx, { model: 0, trim: 5, level: 5 });
      const node = ctx.workletNodes[0];
      await flush();
      expect(node.messages.some((m) => m.type === 'wasm')).toBe(true);
      expect(node.messages.filter((m) => m.type === 'model')).toHaveLength(0);
    });

    it('posts exactly one {type:"model"} with the correct .nam json after wasm-ready', async () => {
      const ctx = new FakeAudioContext();
      create(ctx, { model: 0, trim: 5, level: 5 });
      const node = ctx.workletNodes[0];
      await flush();
      node.emit({ type: 'wasm-ready' });
      await flush();
      const modelMsgs = node.messages.filter((m) => m.type === 'model');
      expect(modelMsgs).toHaveLength(1);
      expect(JSON.parse(modelMsgs[0].json).model).toBe('jcm'); // MODELS[0]
    });

    it('apply() after ready posts the new model on change, dedups trim/level-only changes', async () => {
      const ctx = new FakeAudioContext();
      const fx = create(ctx, { model: 0, trim: 5, level: 5 });
      const node = ctx.workletNodes[0];
      await flush();
      node.emit({ type: 'wasm-ready' });
      await flush();
      const modelMsgs = () => node.messages.filter((m) => m.type === 'model');
      expect(modelMsgs()).toHaveLength(1);

      fx.apply({ model: 1, trim: 5, level: 5 }); // 0 → 1
      await flush();
      expect(modelMsgs()).toHaveLength(2);
      expect(JSON.parse(modelMsgs()[1].json).model).toBe('5153'); // MODELS[1]

      fx.apply({ model: 1, trim: 6, level: 4 }); // model unchanged
      await flush();
      expect(modelMsgs()).toHaveLength(2); // no extra model post
    });

    it('apply() before wasm-ready only updates wantModel; ready posts the latest wanted model', async () => {
      const ctx = new FakeAudioContext();
      const fx = create(ctx, { model: 0, trim: 5, level: 5 });
      const node = ctx.workletNodes[0];
      fx.apply({ model: 2, trim: 5, level: 5 }); // not ready yet: must not post
      await flush();
      expect(node.messages.filter((m) => m.type === 'model')).toHaveLength(0);

      node.emit({ type: 'wasm-ready' });
      await flush();
      const modelMsgs = node.messages.filter((m) => m.type === 'model');
      expect(modelMsgs).toHaveLength(1);
      expect(JSON.parse(modelMsgs[0].json).model).toBe('deluxe'); // MODELS[2]
    });

    it('does not throw when the worklet posts {type:"model-error"}', async () => {
      const ctx = new FakeAudioContext();
      create(ctx, { model: 0, trim: 5, level: 5 });
      const node = ctx.workletNodes[0];
      await flush();
      node.emit({ type: 'wasm-ready' });
      await flush();
      expect(() => node.emit({ type: 'model-error', error: 'nam_load failed' })).not.toThrow();
    });
  });
});
