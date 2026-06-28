// tests/chain-state.test.js
import { describe, it, expect } from 'vitest';
import {
  fromPreset, ampBounds, move, add, remove, setParam, toEngineChain, signature,
} from '../src/chain-state.js';

const PRESET = [
  { type: 'compressor', params: { threshold: -28 } },
  { type: 'drive', params: { amount: 1.5 } },
  { type: 'eq', params: { bass: 6 } },
  { type: 'cabinet', params: { mix: 1 } },
  { type: 'delay', params: { mix: 0.2 } },
];

function build() { return fromPreset(PRESET, 1); }

describe('fromPreset', () => {
  it('assigns sequential ids and locks amp modules', () => {
    const { chain, nextId } = build();
    expect(chain.map(u => u.instanceId)).toEqual([1, 2, 3, 4, 5]);
    expect(chain.map(u => u.locked)).toEqual([false, true, true, true, false]);
    expect(nextId).toBe(6);
  });
  it('copies params (no shared reference)', () => {
    const { chain } = build();
    chain[0].params.threshold = 0;
    expect(PRESET[0].params.threshold).toBe(-28);
  });
});

describe('ampBounds', () => {
  it('returns the contiguous locked range', () => {
    const { chain } = build();
    expect(ampBounds(chain)).toEqual({ start: 1, end: 3 });
  });
  it('returns null when no amp modules', () => {
    const { chain } = fromPreset([{ type: 'delay', params: {} }], 1);
    expect(ampBounds(chain)).toBeNull();
  });
});

describe('move', () => {
  it('moves a post-amp pedal to before the amp (pre-amp)', () => {
    const { chain } = build();
    const moved = move(chain, 5, 0); // delay -> front
    expect(moved.map(u => u.type)).toEqual(['delay', 'compressor', 'drive', 'eq', 'cabinet']);
  });
  it('clamps a drop inside the amp block to just before it', () => {
    const { chain } = build();
    const moved = move(chain, 5, 2); // target index inside amp -> clamp to start (1)
    expect(moved.map(u => u.type)).toEqual(['compressor', 'delay', 'drive', 'eq', 'cabinet']);
  });
  it('keeps the amp block contiguous and ordered after a move', () => {
    const { chain } = build();
    const moved = move(chain, 1, 4); // compressor to the end
    const types = moved.map(u => u.type);
    expect(types.slice(types.indexOf('drive'), types.indexOf('drive') + 3)).toEqual(['drive', 'eq', 'cabinet']);
  });
  it('ignores a locked unit', () => {
    const { chain } = build();
    expect(move(chain, 2, 0).map(u => u.type)).toEqual(chain.map(u => u.type));
  });
});

describe('add', () => {
  it('appends a new pedal with default params and a fresh id', () => {
    const { chain, nextId } = build();
    const r = add(chain, 'reverb', { mix: 0.12 }, nextId);
    expect(r.chain.at(-1)).toMatchObject({ instanceId: 6, type: 'reverb', params: { mix: 0.12 }, locked: false });
    expect(r.nextId).toBe(7);
  });
  it('gives duplicates distinct ids', () => {
    let { chain, nextId } = build();
    ({ chain, nextId } = add(chain, 'delay', {}, nextId));
    ({ chain, nextId } = add(chain, 'delay', {}, nextId));
    const delays = chain.filter(u => u.type === 'delay');
    expect(new Set(delays.map(u => u.instanceId)).size).toBe(delays.length);
  });
});

describe('remove', () => {
  it('removes a pedal', () => {
    const { chain } = build();
    expect(remove(chain, 5).map(u => u.type)).toEqual(['compressor', 'drive', 'eq', 'cabinet']);
  });
  it('ignores a locked unit', () => {
    const { chain } = build();
    expect(remove(chain, 2)).toHaveLength(5);
  });
});

describe('setParam / toEngineChain / signature', () => {
  it('updates a param immutably', () => {
    const { chain } = build();
    const next = setParam(chain, 1, 'threshold', -10);
    expect(next[0].params.threshold).toBe(-10);
    expect(chain[0].params.threshold).toBe(-28);
  });
  it('toEngineChain yields {type, params} in order', () => {
    const { chain } = build();
    expect(toEngineChain(chain)).toEqual([
      { type: 'compressor', params: { threshold: -28 } },
      { type: 'drive', params: { amount: 1.5 } },
      { type: 'eq', params: { bass: 6 } },
      { type: 'cabinet', params: { mix: 1 } },
      { type: 'delay', params: { mix: 0.2 } },
    ]);
  });
  it('signature is order-sensitive', () => {
    const { chain } = build();
    expect(signature(chain)).toBe('compressor>drive>eq>cabinet>delay');
    expect(signature(move(chain, 5, 0))).toBe('delay>compressor>drive>eq>cabinet');
  });
});
