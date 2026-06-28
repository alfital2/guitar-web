# Draggable Effects Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the effects chain directly editable — reorder pedals by drag, remove by dragging off the board, add from a palette — with the amp head (drive/eq/cabinet) locked as a fixed anchor and the chain persisted to localStorage.

**Architecture:** A pure `chain-state` module is the single source of truth (ordered array of `{instanceId, type, params, locked}`). `main.js` owns the live array + an id counter, rebuilds the Web Audio graph from it on any structural change, and renders the amp head (locked modules) and the pedalboard (all modules + AMP anchor) from it. A `chain-store` module persists it to localStorage behind a swappable interface. Pointer-based drag lives in the pedalboard render layer.

**Tech Stack:** Vanilla ES modules, Web Audio API, Vitest + jsdom, no new dependencies.

## Global Constraints

- No new npm dependencies.
- Audio/DSP code is unchanged: `src/engine.js`, `src/effects/*`, `src/dsp.js`, `src/normalize.js`, calibration, pitch. (Modules are *called* with new args but their source is not edited.)
- Amp modules are types `drive`, `eq`, `cabinet`. They are `locked`: never reordered relative to each other, never removed, never have a pedal inserted between them.
- Pedal (addable) types: `compressor`, `delay`, `reverb`, `chorus`. Palette excludes amp types.
- Duplicates allowed → DOM/engine keyed by `instanceId` (integer), never by type.
- Preset switch replaces the chain. Every mutation persists.
- All existing tests stay green (`npx vitest run`).
- Commit message trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create `src/chain-state.js`** — pure functions over a chain array (`fromPreset`, `ampBounds`, `move`, `add`, `remove`, `setParam`, `toEngineChain`, `signature`). No DOM, no audio.
- **Create `src/chain-store.js`** — `load()` / `save(chain)` localStorage persistence behind a single interface.
- **Modify `src/chain-ui/pedalboard.js`** — render from units (pedals + `▣ AMP` anchor + `＋` add tile), nameplate drag handle, pointer reorder, drag-off-to-delete, palette popover.
- **Modify `src/main.js`** — hold `currentChain` + `nextId`, `rebuildGraph()`, wire knob/add/remove/move handlers, persistence, loudness key by signature, init from store-or-preset.
- **Modify `index.html`** — styles for AMP anchor chip, `＋` add tile, palette popover, drag/lift + delete cue.
- **Create `tests/chain-state.test.js`**, **`tests/chain-store.test.js`**; **extend `tests/pedalboard.test.js`**.

---

## Task 1: `chain-state.js` — pure state model

**Files:**
- Create: `src/chain-state.js`
- Test: `tests/chain-state.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fromPreset(presetChain, startId)` → `{ chain, nextId }` where `chain` is `Array<{instanceId:number, type:string, params:object, locked:boolean}>` (locked iff type ∈ {drive,eq,cabinet}; `params` is a shallow copy of each entry's params), `nextId` is the next free integer id.
  - `ampBounds(chain)` → `{ start:number, end:number } | null` — inclusive index range of the contiguous run of locked units (first locked index … last locked index). `null` if none.
  - `move(chain, instanceId, targetIndex)` → new array with the pedal moved to a legal slot. Locked units never move. Target is clamped so the pedal lands before `ampBounds.start` or after `ampBounds.end`, never inside the amp block. Returns the same array (by value equality of contents) if the unit is locked or not found.
  - `add(chain, type, defaultParams, startId)` → `{ chain, nextId }` — appends `{instanceId:startId, type, params:{...defaultParams}, locked:false}`; `nextId = startId+1`.
  - `remove(chain, instanceId)` → new array without that unit; unchanged if the unit is locked or not found.
  - `setParam(chain, instanceId, key, value)` → new array with that unit's `params[key]=value`.
  - `toEngineChain(chain)` → `Array<{type, params}>` in order.
  - `signature(chain)` → string of types joined by `>` (e.g. `"compressor>drive>eq>cabinet>delay"`).

- [ ] **Step 1: Write the failing tests**

Create `tests/chain-state.test.js`:

```javascript
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/chain-state.test.js`
Expected: FAIL — `Failed to resolve import "../src/chain-state.js"`.

- [ ] **Step 3: Implement `src/chain-state.js`**

```javascript
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
  const unit = { instanceId: startId, type, params: { ...defaultParams }, locked: false };
  return { chain: [...chain, unit], nextId: startId + 1 };
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
  return chain.map((u) => ({ type: u.type, params: u.params }));
}

export function signature(chain) {
  return chain.map((u) => u.type).join('>');
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/chain-state.test.js`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/chain-state.js tests/chain-state.test.js
git commit -m "feat: pure chain-state model for editable effects chain

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `chain-store.js` — localStorage persistence

**Files:**
- Create: `src/chain-store.js`
- Test: `tests/chain-store.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `save(chain)` → persists `chain` (array of units) as `{type, params}[]` under localStorage key `gs-chain`. Swallows storage errors.
  - `load()` → returns `Array<{type, params}>` or `null` (no data / malformed / no localStorage).

- [ ] **Step 1: Write the failing tests**

Create `tests/chain-store.test.js`:

```javascript
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
      { type: 'drive', params: { amount: 3 } },
      { type: 'delay', params: { mix: 0.2 } },
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/chain-store.test.js`
Expected: FAIL — cannot resolve `../src/chain-store.js`.

- [ ] **Step 3: Implement `src/chain-store.js`**

```javascript
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/chain-store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/chain-store.js tests/chain-store.test.js
git commit -m "feat: localStorage chain persistence behind swappable interface

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pedalboard renders units + AMP anchor + add tile

**Files:**
- Modify: `src/chain-ui/pedalboard.js`
- Modify: `tests/pedalboard.test.js`
- Modify: `index.html` (styles for `.amp-anchor`, `.pedal-add`, `.pedal-palette`)

**Interfaces:**
- Consumes: `createKnob` (unchanged), `chain-state` not imported here (pedalboard is presentational; it receives ready units).
- Produces: new `renderPedalboard(container, units, handlers)` where:
  - `units` = `Array<{instanceId, type, params, locked}>` — the **full** chain (amp modules included).
  - `handlers` = `{ onParamChange(instanceId, key, value), onAdd(type), onRemove(instanceId), onMove(instanceId, targetIndex) }`. Drag/move wiring is added in Task 4; for this task `onMove` is unused.
  - Renders a `.pedal` card per **non-locked** unit, in order, with a slim `.amp-anchor` card placed at the amp block's position, and a trailing `.pedal-add` (`＋`) tile that toggles a `.pedal-palette` listing pedal types (`compressor`, `delay`, `reverb`, `chorus`).
  - Each pedal card carries `data-instance-id`. Knob change calls `handlers.onParamChange(instanceId, key, value)`.

**Note on signature change:** `renderPedalboard` previously received only non-amp modules and an `onParamChange(index,key,value)` indexed callback. It now receives the **full** chain and an **instanceId-keyed** callback. `main.js` (Task 5) is updated in lockstep. Amp modules are rendered by `amp.js` (unchanged) using the locked subset that `main.js` passes it.

- [ ] **Step 1: Write/replace the failing tests**

Replace the contents of `tests/pedalboard.test.js` with:

```javascript
// tests/pedalboard.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderPedalboard } from '../src/chain-ui/pedalboard.js';

const units = [
  { instanceId: 1, type: 'compressor', locked: false, schema: { label: 'Compressor', params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -24, step: 1 },
  ] }, params: { threshold: -24 } },
  { instanceId: 2, type: 'drive', locked: true, schema: { label: 'Drive', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 },
  ] }, params: { amount: 2.5 } },
  { instanceId: 3, type: 'cabinet', locked: true, schema: { label: 'Cabinet', params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
  ] }, params: { mix: 1 } },
  { instanceId: 4, type: 'delay', locked: false, schema: { label: 'Delay', params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.2, step: 0.01 },
  ] }, params: { mix: 0.2 } },
];
const noop = { onParamChange() {}, onAdd() {}, onRemove() {}, onMove() {} };

describe('renderPedalboard', () => {
  it('renders a card only for non-locked units', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.pedal')).toHaveLength(2); // compressor + delay
    expect(el.querySelector('.pedal').dataset.instanceId).toBe('1');
  });
  it('renders the AMP anchor at the amp block position', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.amp-anchor')).toHaveLength(1);
    // order: compressor card, amp anchor, delay card
    const kinds = [...el.querySelector('.pedalboard').children]
      .filter(c => c.classList.contains('pedal') || c.classList.contains('amp-anchor') || c.classList.contains('connector'))
      .map(c => c.classList.contains('amp-anchor') ? 'AMP' : (c.classList.contains('pedal') ? c.dataset.instanceId : '>'));
    expect(kinds).toEqual(['1', '>', 'AMP', '>', '4']);
  });
  it('renders a + add tile that reveals the palette of pedal types', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    const add = el.querySelector('.pedal-add');
    expect(add).toBeTruthy();
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const opts = [...el.querySelectorAll('.pedal-palette button')].map(b => b.dataset.type);
    expect(opts).toEqual(['compressor', 'delay', 'reverb', 'chorus']);
  });
  it('clicking a palette option calls onAdd(type)', () => {
    const el = document.createElement('div');
    const onAdd = vi.fn();
    renderPedalboard(el, units, { ...noop, onAdd });
    el.querySelector('.pedal-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el.querySelector('.pedal-palette button[data-type="reverb"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onAdd).toHaveBeenCalledWith('reverb');
  });
  it('a knob change calls onParamChange(instanceId, key, value)', () => {
    const el = document.createElement('div');
    const onParamChange = vi.fn();
    renderPedalboard(el, units, { ...noop, onParamChange });
    const firstKnob = el.querySelector('.pedal [role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onParamChange).toHaveBeenCalledWith(1, 'threshold', -23);
  });
  it('clears the container on re-render', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.pedalboard')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/pedalboard.test.js`
Expected: FAIL — assertions about `.amp-anchor` / `.pedal-add` / instanceId-keyed callback not met by current implementation.

- [ ] **Step 3: Rewrite `src/chain-ui/pedalboard.js`**

```javascript
// src/chain-ui/pedalboard.js
import { createKnob } from './knob.js';

const COLORS = {
  compressor: '#0a84ff', drive: '#ff9f0a', eq: '#bf5af2', cabinet: '#32d74b',
  delay: '#ffd60a', reverb: '#ff375f', chorus: '#5ac8fa',
};
// Pedal (addable) types and their display labels. Amp types excluded.
const PEDAL_TYPES = [
  ['compressor', 'Compressor'], ['delay', 'Delay'], ['reverb', 'Reverb'], ['chorus', 'Chorus'],
];

function connector() {
  const c = document.createElement('div');
  c.className = 'connector'; c.textContent = '›'; c.setAttribute('aria-hidden', 'true');
  return c;
}

function buildPedal(unit, handlers) {
  const pedal = document.createElement('div');
  pedal.className = 'pedal';
  pedal.dataset.instanceId = String(unit.instanceId);
  pedal.style.setProperty('--pedal-color', COLORS[unit.type] ?? '#636368');

  const plate = document.createElement('div');
  plate.className = 'pedal-name'; plate.textContent = unit.schema.label;
  plate.dataset.dragHandle = 'true'; // grabbed for reordering (Task 4)

  const knobs = document.createElement('div');
  knobs.className = 'knobs';
  for (const p of unit.schema.params) {
    const { el } = createKnob(p, unit.params[p.key] ?? p.default, (v) => handlers.onParamChange(unit.instanceId, p.key, v), true);
    knobs.appendChild(el);
  }
  const foot = document.createElement('div');
  foot.className = 'pedal-foot';
  const led = document.createElement('div');
  led.className = 'pedal-led';
  foot.appendChild(led);
  pedal.append(plate, knobs, foot);
  return pedal;
}

function ampAnchor() {
  const a = document.createElement('div');
  a.className = 'amp-anchor';
  a.innerHTML = '<span class="amp-anchor-icon">▣</span><span class="amp-anchor-label">AMP</span>';
  a.title = 'Amp head — fixed in the signal chain';
  return a;
}

function addTile(handlers, board) {
  const wrap = document.createElement('div');
  wrap.className = 'pedal-add-wrap';
  const btn = document.createElement('button');
  btn.className = 'pedal-add'; btn.type = 'button'; btn.textContent = '＋';
  btn.setAttribute('aria-label', 'Add effect');

  const palette = document.createElement('div');
  palette.className = 'pedal-palette'; palette.hidden = true;
  for (const [type, label] of PEDAL_TYPES) {
    const opt = document.createElement('button');
    opt.type = 'button'; opt.dataset.type = type; opt.textContent = label;
    opt.addEventListener('click', () => { palette.hidden = true; handlers.onAdd(type); });
    palette.appendChild(opt);
  }
  btn.addEventListener('click', () => { palette.hidden = !palette.hidden; });
  wrap.append(btn, palette);
  return wrap;
}

export function renderPedalboard(container, units, handlers) {
  container.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'pedalboard';

  const ampStart = units.findIndex((u) => u.locked);
  const ampEnd = units.reduce((acc, u, i) => (u.locked ? i : acc), -1);

  let placedAmp = false;
  let prevPlaced = false; // whether a connector should precede the next item
  units.forEach((u, i) => {
    // Place the AMP anchor once, at the first locked index.
    if (u.locked) {
      if (!placedAmp) {
        if (prevPlaced) board.appendChild(connector());
        board.appendChild(ampAnchor());
        placedAmp = true; prevPlaced = true;
      }
      return; // locked modules are not rendered as pedals here
    }
    if (prevPlaced) board.appendChild(connector());
    board.appendChild(buildPedal(u, handlers));
    prevPlaced = true;
  });

  board.appendChild(addTile(handlers, board));
  container.appendChild(board);

  if (!units.some((u) => !u.locked)) {
    const empty = document.createElement('div');
    empty.className = 'pedalboard-empty';
    empty.textContent = 'No effects — add one with ＋';
    board.insertBefore(empty, board.firstChild);
  }
}
```

- [ ] **Step 4: Add styles to `index.html`**

In the `<style>` block, after the existing `.pedalboard-empty` rule, add:

```css
  /* AMP anchor chip in the pedal row */
  .amp-anchor {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    min-width: 56px; align-self: stretch; padding: 8px 10px; border-radius: 11px;
    background: linear-gradient(180deg, rgba(255,159,10,0.12), rgba(255,159,10,0.04));
    border: 1px dashed rgba(255,159,10,0.4); color: var(--accent);
  }
  .amp-anchor-icon { font-size: 14px; line-height: 1; }
  .amp-anchor-label { font-size: 8px; font-weight: 800; letter-spacing: 0.16em; }

  /* Add tile + palette */
  .pedal-add-wrap { position: relative; align-self: stretch; display: flex; }
  .pedal-add {
    min-width: 44px; align-self: stretch; border-radius: 11px; font-size: 20px; line-height: 1;
    color: var(--muted); background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.12);
    cursor: pointer;
  }
  .pedal-add:hover { color: var(--text-secondary); border-color: rgba(255,255,255,0.22); }
  .pedal-palette {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 30; display: flex; flex-direction: column; gap: 2px;
    padding: 6px; min-width: 132px; background: var(--surface); border: 1px solid var(--border-hi);
    border-radius: 8px; box-shadow: 0 12px 32px rgba(0,0,0,0.6);
  }
  .pedal-palette button {
    text-align: left; font-size: 12px; font-weight: 600; color: var(--text-secondary);
    background: transparent; border: none; border-radius: 6px; padding: 7px 9px; cursor: pointer;
  }
  .pedal-palette button:hover { background: var(--surface-hi); color: var(--text); }
  .pedal-name[data-drag-handle] { cursor: grab; }
  .pedal.dragging { opacity: 0.5; }
  .pedalboard.removing { outline: 1.5px dashed var(--red); outline-offset: -4px; }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/pedalboard.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/chain-ui/pedalboard.js tests/pedalboard.test.js index.html
git commit -m "feat: pedalboard renders full chain with AMP anchor and add palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pointer drag — reorder + drag-off-to-delete

**Files:**
- Modify: `src/chain-ui/pedalboard.js`
- Modify: `tests/pedalboard.test.js`

**Interfaces:**
- Consumes: `handlers.onMove(instanceId, targetIndex)`, `handlers.onRemove(instanceId)` from Task 3.
- Produces: pointer-drag behavior. `targetIndex` passed to `onMove` is the index **within the full units array** where the pedal should be inserted (main.js clamps via `chain-state.move`, so the pedalboard may pass its best estimate of slot among rendered pedals mapped back to a unit index). To keep the mapping simple and testable, the pedalboard computes target as the **instanceId of the pedal it was dropped before**, or `null` for end-of-row; main.js converts that to an index. Revised handler shape:
  - `onMove(instanceId, beforeInstanceId | null)` — move `instanceId` to just before `beforeInstanceId`, or to the end (just before the post-amp region's end) when `null`.

  Because drag can't be simulated meaningfully in jsdom (no layout), the testable surface is: (a) a synthetic helper `computeDrop(board, clientX)` exported for unit testing that returns `beforeInstanceId | null` from sibling midpoints, and (b) `onRemove` firing when a drop is flagged outside. Pointer wiring itself is integration-tested manually in the browser (Task 7 verification).

- [ ] **Step 1: Add the failing test for `computeDrop`**

Append to `tests/pedalboard.test.js`:

```javascript
import { computeDrop } from '../src/chain-ui/pedalboard.js';

describe('computeDrop', () => {
  // Build a board with three pedal cards at known x-ranges by stubbing getBoundingClientRect.
  function boardWith(ids) {
    const board = document.createElement('div');
    board.className = 'pedalboard';
    ids.forEach((id, i) => {
      const p = document.createElement('div');
      p.className = 'pedal'; p.dataset.instanceId = String(id);
      // 100px-wide cards starting at x=0,100,200…
      p.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 50, height: 50, x: i * 100, y: 0 });
      board.appendChild(p);
    });
    return board;
  }
  it('returns the id of the card whose left half the cursor is over', () => {
    const board = boardWith([1, 4, 7]);
    expect(computeDrop(board, 10)).toBe(1);   // left of card 1 -> before 1
    expect(computeDrop(board, 160)).toBe(7);  // right half of card 4 -> before 7
  });
  it('returns null past the last card (drop at end)', () => {
    const board = boardWith([1, 4, 7]);
    expect(computeDrop(board, 290)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/pedalboard.test.js`
Expected: FAIL — `computeDrop` not exported.

- [ ] **Step 3: Add `computeDrop` + pointer wiring to `pedalboard.js`**

Add this exported helper (used by drag logic and tests):

```javascript
// Returns the instanceId of the pedal the cursor is "before", or null for end-of-row.
// A drop lands before a card when the cursor is left of that card's horizontal center.
export function computeDrop(board, clientX) {
  const pedals = [...board.querySelectorAll('.pedal')];
  for (const p of pedals) {
    const r = p.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return Number(p.dataset.instanceId);
  }
  return null;
}
```

Then wire pointer dragging by the nameplate. Inside `buildPedal`, after creating `plate`, replace the plain plate with drag handlers by attaching to the pedal via a shared `enableDrag(pedal, plate, unit, handlers, board)` call. Add this function and call it at the end of `buildPedal` (pass `board` down by setting it after board creation — restructure `renderPedalboard` to create `board` first, then build pedals with `board` in scope):

```javascript
function enableDrag(pedal, plate, unit, handlers, getBoard) {
  let dragging = false;
  plate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    pedal.classList.add('dragging');
    plate.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  plate.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const board = getBoard();
    const r = board.getBoundingClientRect();
    const outside = e.clientY < r.top - 24 || e.clientY > r.bottom + 24 || e.clientX < r.left - 24 || e.clientX > r.right + 24;
    board.classList.toggle('removing', outside);
  });
  plate.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    pedal.classList.remove('dragging');
    const board = getBoard();
    const r = board.getBoundingClientRect();
    const outside = e.clientY < r.top - 24 || e.clientY > r.bottom + 24 || e.clientX < r.left - 24 || e.clientX > r.right + 24;
    board.classList.remove('removing');
    if (outside) { handlers.onRemove(unit.instanceId); return; }
    const before = computeDrop(board, e.clientX);
    if (before !== unit.instanceId) handlers.onMove(unit.instanceId, before);
  });
  plate.addEventListener('pointercancel', () => {
    dragging = false; pedal.classList.remove('dragging');
    const board = getBoard(); if (board) board.classList.remove('removing');
  });
}
```

Restructure `renderPedalboard` so `board` exists before pedals are built, and call `enableDrag(pedal, plate, unit, handlers, () => board)` inside the per-unit loop. Update `buildPedal` to return `{ pedal, plate }` so the caller can wire drag:

```javascript
function buildPedal(unit, handlers) {
  const pedal = document.createElement('div');
  pedal.className = 'pedal';
  pedal.dataset.instanceId = String(unit.instanceId);
  pedal.style.setProperty('--pedal-color', COLORS[unit.type] ?? '#636368');

  const plate = document.createElement('div');
  plate.className = 'pedal-name'; plate.textContent = unit.schema.label;
  plate.dataset.dragHandle = 'true';

  const knobs = document.createElement('div');
  knobs.className = 'knobs';
  for (const p of unit.schema.params) {
    const { el } = createKnob(p, unit.params[p.key] ?? p.default, (v) => handlers.onParamChange(unit.instanceId, p.key, v), true);
    knobs.appendChild(el);
  }
  const foot = document.createElement('div');
  foot.className = 'pedal-foot';
  const led = document.createElement('div');
  led.className = 'pedal-led';
  foot.appendChild(led);
  pedal.append(plate, knobs, foot);
  return { pedal, plate };
}
```

And in `renderPedalboard`'s loop, replace `board.appendChild(buildPedal(u, handlers))` with:

```javascript
    const { pedal, plate } = buildPedal(u, handlers);
    enableDrag(pedal, plate, u, handlers, () => board);
    board.appendChild(pedal);
    prevPlaced = true;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/pedalboard.test.js`
Expected: PASS (8 tests — the 6 from Task 3 plus the 2 `computeDrop` tests).

- [ ] **Step 5: Commit**

```bash
git add src/chain-ui/pedalboard.js tests/pedalboard.test.js
git commit -m "feat: pointer drag to reorder pedals and drag-off-to-delete

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Wire `main.js` to the state model + persistence

**Files:**
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `chain-state` (`fromPreset`, `add`, `remove`, `move`, `setParam`, `toEngineChain`, `signature`), `chain-store` (`load`, `save`), `registry` (effect schemas/defaults), `renderPedalboard(container, units, handlers)`, `renderAmp(container, lockedModules, onParamChange)`.
- Produces: editable, persisted chain wired to audio. No new exports (entry module).

This task has no unit test (DOM/audio entry module, consistent with the existing untested `main.js`); it is verified by the full suite staying green plus Task 7 browser verification.

- [ ] **Step 1: Replace chain wiring in `src/main.js`**

Add imports near the top (after existing imports):

```javascript
import * as chainState from './chain-state.js';
import * as chainStore from './chain-store.js';
```

Add module state near the other `let` declarations:

```javascript
let currentChain = [];   // array of units (chain-state model) — source of truth
let nextId = 1;          // monotonic instanceId source
let normTimer = null;    // debounce handle for loudness re-measure
```

Replace the existing `loadPreset(preset)` function and its `normalizeLoudness`/`normCache` usage with the following. Delete the old `currentPreset`/`normCache`-by-name logic and the `AMP_TYPES`/`ampIdx`/`pedIdx` index mapping:

```javascript
// Default schema params for a type, used when adding an effect.
function defaultParams(type) {
  const out = {};
  for (const p of registry[type].schema.params) out[p.key] = p.default;
  return out;
}

// Build the locked (amp-head) module list and the full pedalboard list from
// the current chain, then (re)build the audio graph if running.
function rebuildGraph() {
  // Attach live schema to each unit for the renderers.
  const view = currentChain.map((u) => ({ ...u, schema: registry[u.type].schema }));
  const locked = view.filter((u) => u.locked);

  if (ctx) {
    if (engine) {
      try { calibrationEq.output.disconnect(); } catch {}
      try { engine.output.disconnect(); } catch {}
    }
    engine = buildChain(ctx, chainState.toEngineChain(currentChain), registry);
    if (calibrationEq) calibrationEq.output.connect(engine.input);
    if (normGain) engine.output.connect(normGain);
  }

  try {
    renderAmp($('amp'), locked, (instanceId, key, value) => setParamLive(instanceId, key, value));
    renderPedalboard($('chain'), view, {
      onParamChange: setParamLive,
      onAdd: addEffect,
      onRemove: removeEffect,
      onMove: moveEffect,
    });
  } catch (e) {
    $('error').textContent = 'render: ' + e.message;
    console.error(e);
  }

  chainStore.save(currentChain);
  scheduleNormalize();
}

function setParamLive(instanceId, key, value) {
  currentChain = chainState.setParam(currentChain, instanceId, key, value);
  if (engine) {
    const idx = currentChain.findIndex((u) => u.instanceId === instanceId);
    if (idx >= 0) engine.setParam(idx, key, value);
  }
  chainStore.save(currentChain);
}

function addEffect(type) {
  const r = chainState.add(currentChain, type, defaultParams(type), nextId);
  currentChain = r.chain; nextId = r.nextId;
  rebuildGraph();
}

function removeEffect(instanceId) {
  currentChain = chainState.remove(currentChain, instanceId);
  rebuildGraph();
}

function moveEffect(instanceId, beforeInstanceId) {
  const target = beforeInstanceId == null
    ? currentChain.length
    : currentChain.findIndex((u) => u.instanceId === beforeInstanceId);
  currentChain = chainState.move(currentChain, instanceId, target < 0 ? currentChain.length : target);
  rebuildGraph();
}

function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  const r = chainState.fromPreset(preset.chain, nextId);
  currentChain = r.chain; nextId = r.nextId;
  rebuildGraph();
}

// Restore a persisted chain (array of {type, params}) into the model.
function loadStoredChain(data) {
  const r = chainState.fromPreset(data, nextId);
  currentChain = r.chain; nextId = r.nextId;
  rebuildGraph();
}

let normSig = null;
function scheduleNormalize() {
  if (!normGain) return;
  const sig = chainState.signature(currentChain);
  if (sig === normSig) return; // structure unchanged → skip (param-only edit)
  normSig = sig;
  clearTimeout(normTimer);
  normTimer = setTimeout(async () => {
    try {
      const g = await measureLoudnessGain(chainState.toEngineChain(currentChain), { sampleRate: ctx ? ctx.sampleRate : 48000 });
      if (normGain && chainState.signature(currentChain) === sig) normGain.gain.value = g;
    } catch (e) { console.warn('loudness normalize failed:', e); }
  }, 150);
}
```

Remove the now-dead `normalizeLoudness`, `normCache`, and `currentPreset` declarations (replaced by `scheduleNormalize` + `normSig`).

- [ ] **Step 2: Update `start()` to build from `currentChain`**

In `start()`, the existing block already creates `gainOut`/`normGain` and then calls `renderPresetPicker` + `loadPreset(defaultPreset)`. Replace the preset-load portion so it prefers a stored chain:

Find:
```javascript
    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    loadPreset(defaultPreset);
    const sel = $('presets').querySelector('select');
    if (sel) sel.selectedIndex = PRESETS.indexOf(defaultPreset);
```

Replace with:
```javascript
    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    const stored = chainStore.load();
    if (stored && currentChain.length === 0) loadStoredChain(stored);
    else if (currentChain.length === 0) loadPreset(defaultPreset);
    else rebuildGraph(); // chain already built pre-Start; just wire it to audio
    const sel = $('presets').querySelector('select');
    if (sel) sel.selectedIndex = PRESETS.indexOf(defaultPreset);
```

- [ ] **Step 3: Initialize the chain on page load (pre-Start editable)**

Near the bottom of `main.js`, after the device enumeration call `navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});`, add an init that renders the board before audio starts:

```javascript
// Initialize the editable chain on load (works before Start; audio wires up on Start).
(function initChain() {
  const stored = chainStore.load();
  if (stored && Array.isArray(stored) && stored.length) loadStoredChain(stored);
  else loadPreset(PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0]);
})();
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — all suites green (chain-state, chain-store, pedalboard, amp, knob, and the rest).

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "feat: wire editable persisted chain model into main, rebuild graph on edits

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: amp.js handler signature (instanceId) alignment

**Files:**
- Modify: `src/chain-ui/amp.js`
- Modify: `tests/amp.test.js`

**Interfaces:**
- Consumes: locked module list with `instanceId`, `onParamChange(instanceId, key, value)`.
- Produces: `renderAmp(container, modules, onParamChange)` calling `onParamChange(module.instanceId, key, value)` instead of the old positional `(index, key, value)`.

- [ ] **Step 1: Update the amp test for instanceId callback**

In `tests/amp.test.js`, the modules array lacks `instanceId`. Update the two module objects to include ids and change the callback assertion. Replace the `modules` array and the change test:

```javascript
const modules = [
  { instanceId: 10, type: 'drive', schema: { label: 'Drive', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 },
    { key: 'tone', label: 'Tone', min: 0, max: 10, default: 5, step: 0.1 },
  ] }, params: { amount: 2.5, tone: 5 } },
  { instanceId: 11, type: 'eq', schema: { label: 'EQ', params: [
    { key: 'bass', label: 'Bass', min: 0, max: 10, default: 5, step: 0.1 },
  ] }, params: { bass: 6 } },
];
```

And replace the callback expectation:

```javascript
  it('a knob change calls onParamChange(instanceId, key, value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, modules, cb);
    const firstKnob = el.querySelectorAll('.amp-section')[0].querySelector('[role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(10, 'amount', 2.6);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/amp.test.js`
Expected: FAIL — current `amp.js` calls back with index `0`, not `10`.

- [ ] **Step 3: Update `renderAmp` in `src/chain-ui/amp.js`**

Change the per-module loop so the knob callback uses `m.instanceId`:

Find:
```javascript
  modules.forEach((m, i) => {
```
and the knob line:
```javascript
      const { el } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(i, p.key, v), false);
```
Replace the knob line with:
```javascript
      const { el } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(m.instanceId, p.key, v), false);
```
(The `i` index is no longer needed for the callback; leave the `forEach((m, i) =>` signature as-is — `i` is unused but harmless, or change to `modules.forEach((m) => {`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/amp.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite**

Run: `npx vitest run`
Expected: PASS — everything green.

- [ ] **Step 6: Commit**

```bash
git add src/chain-ui/amp.js tests/amp.test.js
git commit -m "feat: amp head knob callback keyed by instanceId

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Browser verification

**Files:** none (manual/headless verification).

- [ ] **Step 1: Serve and screenshot pre-Start board**

```bash
cd /Users/tal/Documents/guitar_web
python3 -m http.server 8150 >/tmp/gs.log 2>&1 &
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1180,620 --virtual-time-budget=2500 --screenshot=/tmp/chain.png "http://localhost:8150/index.html"
```

Read `/tmp/chain.png`. Expected: pedalboard shows pedals + the `▣ AMP` anchor at the amp's signal position + a `＋` tile, **before** pressing Start (proves always-editable model).

- [ ] **Step 2: Verify add/remove/reorder + persistence via a DevTools-driven harness**

Drive the live page through CDP (Node global WebSocket, same pattern used previously) or a `_probe.html` harness that imports the model and asserts: `add('reverb')` appends; `move` across the amp keeps the amp block contiguous; `remove` drops it; after a reload `chainStore.load()` returns the edited chain. Capture results to a report server or `console`/title.

Expected: add → board gains a reverb pedal; reorder across AMP updates pre/post grouping; remove deletes; reload restores the edited chain.

- [ ] **Step 3: Clean up harness files and stop the server**

```bash
pkill -f "http.server 8150"; rm -f /Users/tal/Documents/guitar_web/_probe.html
```

- [ ] **Step 4: Final full suite + commit any test fixes**

```bash
cd /Users/tal/Documents/guitar_web && npx vitest run
```
Expected: PASS. If verification surfaced a bug, fix with a TDD cycle and commit.

---

## Self-Review Notes

- **Spec coverage:** state model (T1), persistence (T2), pedalboard render + anchor + palette (T3), drag reorder + delete (T4), main wiring + rebuild + loudness-by-signature + pre-Start init (T5), amp instanceId callback (T6), browser verification (T7). All spec sections covered.
- **Keyboard reorder (a11y):** spec mentioned Left/Right/Delete on the handle. Deferred from the core tasks to keep drag landing first; add as a fast-follow if desired. *Noted as a known gap, not silently dropped.*
- **Type consistency:** `onParamChange(instanceId, key, value)` used uniformly in T3/T5/T6. `onMove(instanceId, beforeInstanceId|null)` in T4/T5. `fromPreset(chain, startId) → {chain, nextId}` in T1/T5.
