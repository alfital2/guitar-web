// src/chain-store.js
// Persistence behind a single interface. localStorage now; a DB backend can
// replace the internals later without changing callers.
const KEY = 'gs-chain';

export function save(chain) {
  try {
    const data = chain.map((u) => ({ type: u.type, params: u.params }));
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}
