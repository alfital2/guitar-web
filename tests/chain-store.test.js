// tests/chain-store.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { save, load } from '../src/chain-store.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

beforeEach(() => { vi.stubGlobal('localStorage', memoryStorage()); });

describe('chain-store', () => {
  it('round-trips a chain as {type, params}', () => {
    save([
      { instanceId: 1, type: 'drive', params: { amount: 3 }, locked: true },
      { instanceId: 2, type: 'delay', params: { mix: 0.2 }, locked: false },
    ]);
    expect(load()).toEqual([
      { type: 'drive', params: { amount: 3 }, bypassed: false },
      { type: 'delay', params: { mix: 0.2 }, bypassed: false },
    ]);
  });
  it('returns null when empty', () => {
    expect(load()).toBeNull();
  });
  it('returns null on malformed JSON without throwing', () => {
    localStorage.setItem('gs-chain', '{not json');
    expect(load()).toBeNull();
  });
});
