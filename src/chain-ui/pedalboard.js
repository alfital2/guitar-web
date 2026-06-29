// src/chain-ui/pedalboard.js
import { createKnob } from './knob.js';
import { fxArtSvg, FX_FONTS, fxWidth, FX_KNOB_STYLE, FX_KNOB_LAYOUT } from './fx-art.js';

const COLORS = {
  compressor: '#0a84ff',
  drive: '#ff9f0a',
  eq: '#bf5af2',
  cabinet: '#32d74b',
  delay: '#ffd60a',
  reverb: '#ff375f',
  chorus: '#5ac8fa',
  boost: '#ff9500',
  fuzz: '#ff453a',
  octave: '#ff6482',
  tremolo: '#64d2ff',
  vibrato: '#40c8e0',
  flanger: '#7d7aff',
  phaser: '#bf5af2',
  ringmod: '#ac8e68',
  autowah: '#30d158',
  gate: '#8e8e93',
  wah: '#ffd60a',
  'tape-echo': '#d4a017',
  pingpong: '#ffc857',
  widener: '#5e5ce6',
  limiter: '#0a84ff',
  pitchshift: '#ff2d55',
  looper: '#34c759',
  autopan: '#00c7be',
  rotary: '#a2845e',
};

// Pedal (addable) types and their display labels. Amp types (drive/eq/cabinet)
// are excluded — they live in the amp head. Keep this in sync with the effects
// registry: only list types that have a registered effect.
const PEDAL_TYPES = [
  ['compressor', 'Compressor'], ['boost', 'Boost'], ['gate', 'Noise Gate'],
  ['fuzz', 'Fuzz'], ['octave', 'Octave Fuzz'],
  ['wah', 'Wah'], ['autowah', 'Auto-Wah'],
  ['chorus', 'Chorus'], ['flanger', 'Flanger'], ['phaser', 'Phaser'],
  ['tremolo', 'Tremolo'], ['vibrato', 'Vibrato'], ['autopan', 'Auto-Pan'],
  ['rotary', 'Rotary'], ['ringmod', 'Ring Mod'],
  ['delay', 'Delay'], ['tape-echo', 'Tape Echo'], ['pingpong', 'Ping-Pong'],
  ['reverb', 'Reverb'], ['widener', 'Widener'], ['limiter', 'Limiter'],
  ['pitchshift', 'Pitch Shift'], ['looper', 'Looper'],
];

function connector() {
  const c = document.createElement('div');
  c.className = 'connector'; c.textContent = '›'; c.setAttribute('aria-hidden', 'true');
  return c;
}

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

function outsideBoard(board, e) {
  const r = board.getBoundingClientRect();
  return e.clientY < r.top - 24 || e.clientY > r.bottom + 24 || e.clientX < r.left - 24 || e.clientX > r.right + 24;
}

const FLIP_EASE = 'transform .19s cubic-bezier(.2,.85,.25,1)';

// Slot items the placeholder can sit among: real pedals (not the lifted one) and
// the AMP anchor. Connectors and the add tile are excluded from slot math.
function slotItems(board, lifted) {
  return [...board.children].filter((c) =>
    (c.classList.contains('pedal') && c !== lifted) || c.classList.contains('amp-anchor'));
}

// The chain id the placeholder drops "before": a pedal's instanceId, the amp
// block's first id (drop into the pre-amp slot), or null for end-of-row.
function nextDropId(ph) {
  let n = ph.nextElementSibling;
  while (n && n.classList.contains('connector')) n = n.nextElementSibling;
  if (!n) return null;
  if (n.classList.contains('amp-anchor')) return Number(n.dataset.beforeId);
  if (n.classList.contains('pedal')) return Number(n.dataset.instanceId);
  return null;
}

// Move the placeholder to the slot under the cursor and animate the displaced
// items into their new positions (FLIP) so the row flows like rearranging apps.
function repositionPlaceholder(board, lifted, ph, clientX) {
  const items = slotItems(board, lifted);
  let target = null;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (clientX < r.left + r.width / 2) { target = it; break; }
  }
  const anchor = target || board.querySelector('.pedal-add-wrap');
  if (ph.nextElementSibling === anchor || (target && target.previousElementSibling === ph)) return;

  // FLIP: record, move, invert+play.
  const flippers = [...board.children].filter((c) =>
    (c.classList.contains('pedal') && c !== lifted) || c.classList.contains('amp-anchor') || c.classList.contains('connector'));
  const first = new Map(flippers.map((el) => [el, el.getBoundingClientRect().left]));
  board.insertBefore(ph, anchor);
  for (const el of flippers) {
    const dx = first.get(el) - el.getBoundingClientRect().left;
    if (!dx) continue;
    el.style.transition = 'none';
    el.style.transform = `translateX(${dx}px)`;
    requestAnimationFrame(() => { el.style.transition = FLIP_EASE; el.style.transform = ''; });
  }
}

// Pointer-drag a pedal by its nameplate. The pedal lifts and follows the cursor;
// a placeholder holds its slot and the other pedals flow aside in real time.
// Dragging off the board deletes it.
function enableDrag(pedal, plate, unit, handlers, getBoard) {
  let drag = null;
  plate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = pedal.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };

    const ph = document.createElement('div');
    ph.className = 'pedal-placeholder';
    ph.style.width = `${rect.width}px`;
    ph.style.height = `${rect.height}px`;
    pedal.before(ph);
    drag.ph = ph;

    pedal.classList.add('lifting');
    pedal.style.width = `${rect.width}px`;
    pedal.style.height = `${rect.height}px`;
    pedal.style.left = `${rect.left}px`;
    pedal.style.top = `${rect.top}px`;
    try { plate.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });

  plate.addEventListener('pointermove', (e) => {
    if (!drag) return;
    pedal.style.left = `${e.clientX - drag.dx}px`;
    pedal.style.top = `${e.clientY - drag.dy}px`;
    const board = getBoard();
    const outside = outsideBoard(board, e);
    board.classList.toggle('removing', outside);
    pedal.classList.toggle('will-delete', outside);
    if (!outside) repositionPlaceholder(board, pedal, drag.ph, e.clientX);
  });

  plate.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const board = getBoard();
    const ph = drag.ph;
    const outside = outsideBoard(board, e);
    board.classList.remove('removing');
    drag = null;

    if (outside) {
      pedal.style.transition = 'transform .15s ease, opacity .15s ease';
      pedal.style.transform = 'scale(.55)';
      pedal.style.opacity = '0';
      ph.remove();
      handlers.onRemove(unit.instanceId); // re-render replaces the faded element
      return;
    }

    const before = nextDropId(ph);
    // Glide the lifted pedal into the placeholder slot, then commit (re-render).
    const pr = ph.getBoundingClientRect();
    pedal.style.transition = 'left .19s cubic-bezier(.2,.85,.25,1), top .19s cubic-bezier(.2,.85,.25,1)';
    pedal.style.left = `${pr.left}px`;
    pedal.style.top = `${pr.top}px`;
    let done = false;
    const commit = () => {
      if (done) return; done = true;
      ph.remove();
      handlers.onMove(unit.instanceId, before);
    };
    pedal.addEventListener('transitionend', commit, { once: true });
    setTimeout(commit, 240); // safety if transitionend doesn't fire
  });

  plate.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.ph.remove();
    drag = null;
    handlers.onMove(unit.instanceId, unit.instanceId); // re-render to reset
  });
}

// Pedal knobs are rendered a touch smaller than amp knobs so the control band
// fits inside the bespoke faceplate (which is sized to the knob count).
const PEDAL_KNOB_SIZE = 36;

function buildPedal(unit, handlers) {
  const pedal = document.createElement('div');
  pedal.className = 'pedal';
  pedal.dataset.instanceId = String(unit.instanceId);
  const color = COLORS[unit.type] ?? '#636368';
  pedal.style.setProperty('--pedal-color', color); // LED
  pedal.style.setProperty('--c', color);           // (faceplate art uses baked colors)
  pedal.style.width = `${fxWidth(unit.type)}px`;

  // Bespoke faceplate art sizes the box; the wordmark is baked into the art.
  const art = fxArtSvg(unit.type);
  art.classList.add('pedal-art');

  // The whole face is the drag handle; knobs sit above it (higher z) and
  // capture their own pointer events, so dragging works everywhere else.
  const grip = document.createElement('div');
  grip.className = 'pedal-grip';
  grip.dataset.dragHandle = 'true';
  grip.setAttribute('aria-label', `${unit.schema.label} — drag to reorder`);

  const knobs = document.createElement('div');
  knobs.className = 'pedal-knobs';
  const layout = FX_KNOB_LAYOUT[unit.type];
  const style = FX_KNOB_STYLE[unit.type] || {};
  const params = unit.schema.params;
  params.forEach((p, i) => {
    // Per-pedal slot; fall back to an evenly-spaced row if a layout slot is missing.
    const slot = (layout && layout[i]) || { x: fxWidth(unit.type) / 2 + (i - (params.length - 1) / 2) * 40, y: 128 };
    const size = slot.r || PEDAL_KNOB_SIZE;
    const { el } = createKnob(p, unit.params[p.key] ?? p.default, (v) => handlers.onParamChange(unit.instanceId, p.key, v), size, style);
    el.style.left = `${slot.x}px`;
    el.style.top = `${slot.y - size / 2}px`;
    knobs.appendChild(el);
  });

  if (unit.bypassed) pedal.classList.add('bypassed');
  // Footswitch hit area: a generous button around the small LED so a press near
  // the indicator toggles power instead of starting a drag.
  const power = document.createElement('button');
  power.type = 'button';
  power.className = 'pedal-power';
  power.setAttribute('role', 'switch');
  power.setAttribute('aria-checked', unit.bypassed ? 'false' : 'true');
  power.setAttribute('aria-label', `${unit.schema.label} power`);
  power.title = unit.bypassed ? 'Off — click to power on' : 'On — click to bypass';
  const led = document.createElement('span');
  led.className = 'pedal-led';
  power.appendChild(led);
  // Stop the drag-grip from reacting to a press in this zone.
  power.addEventListener('pointerdown', (e) => e.stopPropagation());
  power.addEventListener('click', (e) => { e.stopPropagation(); handlers.onToggleBypass?.(unit.instanceId); });

  pedal.append(art, grip, knobs, power);
  return { pedal, plate: grip };
}

function ampAnchor(beforeId) {
  const a = document.createElement('div');
  a.className = 'amp-anchor';
  // Dropping "before" the amp targets this id → the pre-amp slot.
  if (beforeId != null) a.dataset.beforeId = String(beforeId);
  a.innerHTML = '<span class="amp-anchor-icon">▣</span><span class="amp-anchor-label">AMP</span>';
  a.title = 'Amp head — fixed in the signal chain';
  return a;
}

function addTile(handlers) {
  const wrap = document.createElement('div');
  wrap.className = 'pedal-add-wrap';
  const btn = document.createElement('button');
  btn.className = 'pedal-add'; btn.type = 'button'; btn.textContent = '＋';
  btn.setAttribute('aria-label', 'Add effect');
  btn.addEventListener('click', () => openEffectsModal(handlers));
  wrap.append(btn);
  return wrap;
}

// A floating chip that follows the cursor while dragging an effect from the
// window onto the board.
function makeGhost(label, type) {
  const g = document.createElement('div');
  g.className = 'fx-ghost';
  g.style.setProperty('--pedal-color', COLORS[type] ?? '#636368');
  g.textContent = label;
  document.body.appendChild(g);
  return g;
}

// Wire a window tile: click adds (append); drag carries it onto the board and
// drops it at the hovered slot (insert), with the same flow/placeholder feel.
function attachTileDrag(tile, type, label, handlers, getBoard, close) {
  let st = null;
  tile.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    st = { x: e.clientX, y: e.clientY, dragging: false };
    try { tile.setPointerCapture(e.pointerId); } catch {}
  });
  tile.addEventListener('pointermove', (e) => {
    if (!st) return;
    const board = getBoard();
    if (!st.dragging) {
      if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < 6) return;
      st.dragging = true;
      document.querySelector('.fx-modal-backdrop')?.classList.add('hidden');
      tile.closest('.fx-modal')?.classList.add('hidden');
      st.ghost = makeGhost(label, type);
      const sample = board && board.querySelector('.pedal');
      const r = sample ? sample.getBoundingClientRect() : { width: 122, height: 120 };
      st.ph = document.createElement('div');
      st.ph.className = 'pedal-placeholder';
      st.ph.style.width = `${r.width}px`; st.ph.style.height = `${r.height}px`;
    }
    st.ghost.style.left = `${e.clientX + 10}px`;
    st.ghost.style.top = `${e.clientY + 10}px`;
    if (board && overBoard(board, e)) repositionPlaceholder(board, null, st.ph, e.clientX);
    else st.ph.remove();
  });
  tile.addEventListener('pointerup', (e) => {
    if (!st) return;
    const board = getBoard();
    if (!st.dragging) { handlers.onAdd(type); close(); st = null; return; }
    const over = board && overBoard(board, e) && st.ph.parentNode;
    const beforeId = over ? nextDropId(st.ph) : undefined;
    st.ghost?.remove(); st.ph?.remove();
    if (over) handlers.onAdd(type, beforeId);
    close();
    st = null;
  });
  tile.addEventListener('pointercancel', () => { st?.ghost?.remove(); st?.ph?.remove(); st = null; });
}

function overBoard(board, e) {
  const r = board.getBoundingClientRect();
  return e.clientY > r.top - 30 && e.clientY < r.bottom + 30 && e.clientX > r.left - 30 && e.clientX < r.right + 30;
}

// The "Add Effect" window: a modal listing every pedal effect. Click to append,
// or drag a tile onto the board to insert it at a chosen position.
export function openEffectsModal(handlers) {
  document.querySelectorAll('.fx-modal-backdrop, .fx-modal, .fx-ghost').forEach((n) => n.remove());
  const getBoard = () => document.querySelector('.pedalboard');

  const backdrop = document.createElement('div');
  backdrop.className = 'fx-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'fx-modal';
  const head = document.createElement('div');
  head.className = 'fx-modal-head';
  head.innerHTML = '<span>Add Effect</span>';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'fx-modal-close'; closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', 'Close'); closeBtn.textContent = '✕';
  head.appendChild(closeBtn);
  const hint = document.createElement('div');
  hint.className = 'fx-modal-hint'; hint.textContent = 'Click to add, or drag onto the board';
  const grid = document.createElement('div');
  grid.className = 'fx-grid';

  const close = () => {
    backdrop.remove(); modal.remove();
    document.querySelectorAll('.fx-ghost').forEach((n) => n.remove());
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };

  for (const [type, label] of PEDAL_TYPES) {
    const tile = document.createElement('button');
    tile.className = 'fx-tile'; tile.type = 'button'; tile.dataset.type = type;
    const color = COLORS[type] ?? '#636368';
    tile.style.setProperty('--pedal-color', color);
    tile.style.setProperty('--c', color);
    const font = FX_FONTS[type];
    if (font) { tile.style.setProperty('--font', font.family); tile.style.setProperty('--font-ls', font.ls); }
    tile.appendChild(fxArtSvg(type));
    const span = document.createElement('span');
    span.className = 'fx-tile-label'; span.textContent = label;
    tile.appendChild(span);
    attachTileDrag(tile, type, label, handlers, getBoard, close);
    grid.appendChild(tile);
  }

  modal.append(head, hint, grid);
  backdrop.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop, modal);
  return close;
}

export function renderPedalboard(container, units, handlers) {
  container.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'pedalboard';

  const firstLockedId = units.find((u) => u.locked)?.instanceId;
  let placedAmp = false;
  let prevPlaced = false; // whether a connector should precede the next item
  units.forEach((u) => {
    if (u.locked) {
      // Place the AMP anchor once, at the first locked module's position.
      if (!placedAmp) {
        if (prevPlaced) board.appendChild(connector());
        board.appendChild(ampAnchor(firstLockedId));
        placedAmp = true; prevPlaced = true;
      }
      return; // locked modules render in the amp head, not as pedals
    }
    if (prevPlaced) board.appendChild(connector());
    const { pedal, plate } = buildPedal(u, handlers);
    enableDrag(pedal, plate, u, handlers, () => board);
    board.appendChild(pedal);
    prevPlaced = true;
  });

  board.appendChild(addTile(handlers));

  if (!units.some((u) => !u.locked)) {
    const empty = document.createElement('div');
    empty.className = 'pedalboard-empty';
    empty.textContent = 'No effects — add one with ＋';
    board.insertBefore(empty, board.firstChild);
  }

  container.appendChild(board);
}
