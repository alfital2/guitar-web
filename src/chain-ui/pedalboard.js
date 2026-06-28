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

// Pointer-drag a pedal by its nameplate: reorder within the board, or drag off
// the board to delete. Knobs handle their own pointer events independently.
function enableDrag(pedal, plate, unit, handlers, getBoard) {
  let dragging = false;
  plate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    pedal.classList.add('dragging');
    try { plate.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  plate.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    getBoard().classList.toggle('removing', outsideBoard(getBoard(), e));
  });
  plate.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    pedal.classList.remove('dragging');
    const board = getBoard();
    const outside = outsideBoard(board, e);
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

function ampAnchor() {
  const a = document.createElement('div');
  a.className = 'amp-anchor';
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

  let placedAmp = false;
  let prevPlaced = false; // whether a connector should precede the next item
  units.forEach((u) => {
    if (u.locked) {
      // Place the AMP anchor once, at the first locked module's position.
      if (!placedAmp) {
        if (prevPlaced) board.appendChild(connector());
        board.appendChild(ampAnchor());
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
