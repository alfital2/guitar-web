// src/chain-state.js
// Pure ordered-chain model. No DOM, no audio. Array order == signal order.
const AMP_TYPES = new Set(['drive', 'eq', 'cabinet']);

export function fromPreset(presetChain, startId) {
  let nextId = startId;
  const chain = presetChain.map((e) => ({
    instanceId: nextId++,
    type: e.type,
    params: { ...e.params },
    locked: AMP_TYPES.has(e.type),
    bypassed: !!e.bypassed,
  }));
  return { chain, nextId };
}

export function ampBounds(chain) {
  let start = -1, end = -1;
  chain.forEach((u, i) => { if (u.locked) { if (start === -1) start = i; end = i; } });
  return start === -1 ? null : { start, end };
}

export function move(chain, instanceId, targetIndex) {
  const from = chain.findIndex((u) => u.instanceId === instanceId);
  if (from === -1 || chain[from].locked) return chain.slice();
  const without = chain.filter((u) => u.instanceId !== instanceId);
  // Recompute amp block on the array without the moving pedal, then clamp the
  // insertion index so the pedal lands before or after the block, never inside.
  const b = ampBounds(without);
  let idx = Math.max(0, Math.min(targetIndex, without.length));
  if (b && idx > b.start && idx <= b.end) idx = idx - b.start <= b.end - idx + 1 ? b.start : b.end + 1;
  without.splice(idx, 0, chain[from]);
  return without;
}

export function add(chain, type, defaultParams, startId) {
  const unit = { instanceId: startId, type, params: { ...defaultParams }, locked: false, bypassed: false };
  return { chain: [...chain, unit], nextId: startId + 1 };
}

// Toggle an effect's bypass (power). Amp modules can't be bypassed here.
export function toggleBypass(chain, instanceId) {
  return chain.map((u) => (u.instanceId === instanceId && !u.locked ? { ...u, bypassed: !u.bypassed } : u));
}

export function remove(chain, instanceId) {
  const u = chain.find((x) => x.instanceId === instanceId);
  if (!u || u.locked) return chain.slice();
  return chain.filter((x) => x.instanceId !== instanceId);
}

export function setParam(chain, instanceId, key, value) {
  return chain.map((u) => (u.instanceId === instanceId ? { ...u, params: { ...u.params, [key]: value } } : u));
}

export function toEngineChain(chain) {
  return chain.map((u) => ({ type: u.type, params: u.params, bypassed: !!u.bypassed }));
}

export function signature(chain) {
  // Include bypass so loudness re-measures when an effect is powered on/off.
  return chain.map((u) => (u.bypassed ? `!${u.type}` : u.type)).join('>');
}
