// src/chain-ui/pedalboard.js
import { createKnob } from './knob.js';

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
};

// Pedal (addable) types and their display labels. Amp types (drive/eq/cabinet)
// are excluded — they live in the amp head. Keep this in sync with the effects
// registry: only list types that have a registered effect.
const PEDAL_TYPES = [
  ['compressor', 'Compressor'], ['boost', 'Boost'], ['gate', 'Noise Gate'],
  ['fuzz', 'Fuzz'], ['octave', 'Octave Fuzz'],
  ['wah', 'Wah'], ['autowah', 'Auto-Wah'],
  ['chorus', 'Chorus'], ['flanger', 'Flanger'], ['phaser', 'Phaser'],
  ['tremolo', 'Tremolo'], ['vibrato', 'Vibrato'], ['ringmod', 'Ring Mod'],
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
