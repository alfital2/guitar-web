// src/chain-ui/pedalboard.js
import { createKnob } from './knob.js';
import { FX_FONTS, FX_BODY, pedalTypographyVars, FX_MOTIFS } from './fx-art.js';
import { registerViz, resetViz } from './fx-viz.js';

// Chrome cap for the CSS-pedal knobs (light → mid → dark), amber-ish arc per effect.
const PEDAL_CAP = ['#eef2f5', '#aeb4ba', '#40454a'];

// Pedal body colors are the single source of truth in fx-art.js (FX_BODY), so
// the typography contrast test measures ink against exactly what renders.
const COLORS = FX_BODY;

// Pedal (addable) types and their display labels. Amp types (drive/eq/cabinet)
// are excluded — they live in the amp head. Reverb is also excluded: it's now a
// built-in amp stage, not a pedal. Keep this in sync with the effects registry:
// only list types that have a registered effect.
const PEDAL_TYPES = [
  ['compressor', 'Compressor'], ['boost', 'Boost'], ['gate', 'Noise Gate'],
  ['distortion', 'Distortion'], ['fuzz', 'Fuzz'], ['octave', 'Octave Fuzz'],
  ['acousticsim', 'Acoustic Sim'],
  ['wah', 'Wah'], ['autowah', 'Auto-Wah'],
  ['chorus', 'Chorus'], ['flanger', 'Flanger'], ['phaser', 'Phaser'],
  ['univibe', 'Uni-Vibe'],
  ['tremolo', 'Tremolo'], ['vibrato', 'Vibrato'], ['autopan', 'Auto-Pan'],
  ['rotary', 'Rotary'], ['ringmod', 'Ring Mod'],
  ['delay', 'Delay'], ['tape-echo', 'Tape Echo'], ['pingpong', 'Ping-Pong'],
  ['springverb', 'Spring Reverb'],
  ['widener', 'Widener'], ['limiter', 'Limiter'],
  ['pitchshift', 'Pitch Shift'], ['harmonizer', 'Harmonizer'], ['whammy', 'Whammy'],
  ['looper', 'Looper'],
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
// A press must MOVE past this many px before it becomes a drag. Without it,
// every click on the pedal face instantly lifted the pedal — so a click meant
// for the small footswitch (or a near-miss) jumped the pedal aside and ate the
// toggle. Below the threshold the press stays a plain click.
const PEDAL_DRAG_THRESHOLD = 5;

function enableDrag(pedal, plate, unit, handlers, getBoard) {
  let drag = null; // { dx, dy, startX, startY, pointerId, rect, active, ph }

  // Promote a pending press into a real drag: lift the pedal + drop a placeholder.
  function activateDrag() {
    const rect = drag.rect;
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
    try { plate.setPointerCapture(drag.pointerId); } catch {}
    drag.active = true;
  }

  plate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = pedal.getBoundingClientRect();
    // Record only — don't lift yet. The lift waits for real movement so a plain
    // click reaches the knob/footswitch/arm handlers underneath.
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, rect, active: false, ph: null };
  });

  plate.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < PEDAL_DRAG_THRESHOLD) return;
      activateDrag();
    }
    pedal.style.left = `${e.clientX - drag.dx}px`;
    pedal.style.top = `${e.clientY - drag.dy}px`;
    const board = getBoard();
    const outside = outsideBoard(board, e);
    board.classList.toggle('removing', outside);
    pedal.classList.toggle('will-delete', outside);
    if (!outside) repositionPlaceholder(board, pedal, drag.ph, e.clientX);
    e.preventDefault();
  });

  plate.addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (!drag.active) { drag = null; return; } // never moved → it was a click, let it fire
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
    const wasActive = drag.active, ph = drag.ph;
    drag = null;
    if (wasActive) { if (ph) ph.remove(); handlers.onMove(unit.instanceId, unit.instanceId); } // re-render to reset
  });
}

// Knob hardware finishes. Each effect gets ONE finish for its whole knob row
// (real pedals ship matching knobs) — but different effects get different
// hardware, picked deterministically from the type name, so the board isn't
// a wall of identical chrome. Pointer ink always contrasts the cap.
const KNOB_FINISHES = [
  { cap: ['#eef2f5', '#aeb4ba', '#40454a'], pointer: '#16181b' },                    // brushed chrome
  { cap: ['#6d6d75', '#2f2f35', '#111116'], pointer: '#f2f2f4' },                    // black rubber
  { cap: ['#f6efdc', '#dcd2b6', '#8f8468'], pointer: '#2a2118' },                    // vintage cream
  { cap: ['#4a4a52', '#242429', '#0c0c0f'], pointer: '#f4e8c8', shape: 'chicken' },  // bakelite chicken-head
];
function knobFinishFor(type) {
  let h = 0;
  for (const ch of String(type)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return KNOB_FINISHES[h % KNOB_FINISHES.length];
}

// Mini pedal icon for the "Add Effect" tiles (matches the new CSS pedals).
function pedalIcon(type, color) {
  const d = document.createElement('div');
  d.className = 'fx-tile-pedal';
  d.style.setProperty('--c', color);
  d.innerHTML = `<div class="fx-tile-plate"><svg viewBox="0 0 102 80" fill="none">${FX_MOTIFS[type] || ''}</svg></div><div class="fx-tile-gloss"></div>`;
  return d;
}

function buildPedal(unit, handlers) {
  const type = unit.type;
  const color = COLORS[type] ?? '#8a8a90';
  const params = unit.schema.params;
  const n = params.length;

  const pedal = document.createElement('div');
  pedal.className = 'pedal';
  pedal.dataset.instanceId = String(unit.instanceId);
  pedal.style.setProperty('--c', color);
  pedal.style.setProperty('--pedal-color', color);
  pedal.style.setProperty('--cols', String(n));
  // Per-effect name font/treatment/ink + shared condensed knob-label ink.
  for (const [k, v] of Object.entries(pedalTypographyVars(type))) pedal.style.setProperty(k, v);
  pedal.style.width = `${Math.max(132, 44 + n * 40)}px`; // wider slots for the 34px knobs
  if (unit.bypassed) pedal.classList.add('bypassed');

  // Recessed faceplate: rotating sunburst (fuzz only) + glow + screen + glass lens.
  const plate = document.createElement('div');
  plate.className = 'pedal-plate';
  if (type === 'fuzz') { const rays = document.createElement('div'); rays.className = 'pedal-rays'; plate.appendChild(rays); }
  const glow = document.createElement('div'); glow.className = 'pedal-glow';
  // On the BOARD the screen is a live effect-viz canvas (param-driven animation
  // of what the effect does to sound); palette tiles keep the static motif SVG.
  // The params getter reads the LIVE chain model, so knob turns show on the
  // next viz tick. Falls back to the motif when a type has no viz.
  let art = document.createElement('canvas');
  art.className = 'pedal-viz';
  const hasViz = registerViz(art, type,
    () => handlers.getLiveParams?.(unit.instanceId) ?? unit.params,
    { bypassed: unit.bypassed });
  if (!hasViz) {
    art = document.createElement('div'); art.className = 'pedal-motif';
    art.innerHTML = `<svg viewBox="0 0 102 80" fill="none">${FX_MOTIFS[type] || ''}</svg>`;
  }
  const lens = document.createElement('div'); lens.className = 'pedal-lens';
  plate.append(glow, art, lens);

  // The whole face is the drag handle; knobs/footswitch sit above (higher z).
  const grip = document.createElement('div');
  grip.className = 'pedal-grip';
  grip.dataset.dragHandle = 'true';
  grip.setAttribute('aria-label', `${unit.schema.label} — drag to reorder`);

  // Real interactive knobs in a grid (one row, widened per knob count).
  const knobs = document.createElement('div');
  knobs.className = 'pedal-knobs';
  params.forEach((p) => {
    const slot = document.createElement('div');
    slot.className = 'pedal-knob';
    const finish = knobFinishFor(type);
    const { el } = createKnob(p, unit.params[p.key] ?? p.default,
      (v) => handlers.onParamChange(unit.instanceId, p.key, v), 34,
      { cap: finish.cap, accent: color, pointer: finish.pointer, shape: finish.shape });
    const lbl = document.createElement('b');
    lbl.textContent = p.label;
    slot.append(el, lbl);
    knobs.appendChild(slot);
  });

  // The name is the branding element. Keep the schema's own casing in the DOM
  // (script faces stay mixed-case); CSS `text-transform` uppercases the rest.
  const word = document.createElement('div');
  word.className = 'pedal-word';
  word.textContent = unit.schema.label;

  const led = document.createElement('span');
  led.className = 'pedal-led';

  // Footswitch = bypass toggle.
  const power = document.createElement('button');
  power.type = 'button';
  power.className = 'pedal-power';
  power.setAttribute('role', 'switch');
  power.setAttribute('aria-checked', unit.bypassed ? 'false' : 'true');
  power.setAttribute('aria-label', `${unit.schema.label} power`);
  power.title = unit.bypassed ? 'Off — click to power on' : 'On — click to bypass';
  power.addEventListener('pointerdown', (e) => e.stopPropagation());
  power.addEventListener('click', (e) => {
    e.stopPropagation();
    // Tactile footswitch stomp: a 90ms scale(.96) press (transform-only). The
    // class is cleared on animationend so a rapid re-toggle re-triggers it.
    power.classList.remove('fs-press');
    void power.offsetWidth; // reflow so the animation restarts
    power.classList.add('fs-press');
    power.addEventListener('animationend', () => power.classList.remove('fs-press'), { once: true });
    handlers.onToggleBypass?.(unit.instanceId);
  });

  const gloss = document.createElement('div'); gloss.className = 'pedal-body-gloss';
  const screws = ['tl', 'tr', 'bl', 'br'].map((c) => {
    const s = document.createElement('span'); s.className = `pedal-screw pedal-screw-${c}`; return s;
  });

  pedal.append(plate, grip, knobs, word, led, power, gloss, ...screws);
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
    tile.appendChild(pedalIcon(type, color));
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

// Collapsed board strip: the whole chain as a slim row of mini pedals (same
// art as the palette tiles) + the AMP chip, in signal order — like the amp's
// collapsed value strip. Click anywhere to expand back to the full board.
function buildBoardStrip(units) {
  const strip = document.createElement('div');
  strip.className = 'board-strip';
  // Expand affordance: unified with the amp strip + preset browser —
  // keyboard-focusable, aria-expanded reflects the (collapsed) panel state.
  strip.setAttribute('role', 'button');
  strip.setAttribute('tabindex', '0');
  strip.setAttribute('aria-expanded', 'false');
  strip.setAttribute('aria-label', 'Expand effects chain to edit');
  strip.title = 'Effects chain — click to edit';
  let placedAmp = false;
  units.forEach((u) => {
    if (u.locked) {
      if (!placedAmp) {
        const chip = document.createElement('div');
        chip.className = 'board-strip-amp';
        chip.textContent = 'AMP';
        strip.appendChild(chip);
        placedAmp = true;
      }
      return;
    }
    const mini = pedalIcon(u.type, COLORS[u.type] ?? '#8a8a90');
    mini.classList.add('board-strip-mini');
    if (u.bypassed) mini.classList.add('off');
    mini.title = u.schema.label + (u.bypassed ? ' — off' : '');
    strip.appendChild(mini);
  });
  if (!units.some((u) => !u.locked)) {
    const none = document.createElement('span');
    none.className = 'board-strip-none';
    none.textContent = 'No effects';
    strip.appendChild(none);
  }
  const exp = document.createElement('div');
  exp.className = 'board-strip-exp';
  exp.innerHTML = '<span>TAP TO EDIT</span><span class="board-strip-chev">▾</span>';
  strip.appendChild(exp);
  return strip;
}

export function renderPedalboard(container, units, handlers, opts = {}) {
  resetViz(); // the board fully re-renders — drop every stale viz canvas first
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'board-wrap' + (opts.collapsed ? ' collapsed' : '');
  const board = document.createElement('div');
  board.className = 'pedalboard';

  const firstLockedId = units.find((u) => u.locked)?.instanceId;
  let placedAmp = false;
  let prevPlaced = false; // whether a connector should precede the next item
  let pedalIndex = 0;     // for staggering the per-pedal glint
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
    // Stagger the autonomous specular glint (CSS ::after) by row position so the
    // pedals don't all flash at once.
    pedal.style.setProperty('--gi', String(pedalIndex++));
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

  // Collapse chevron (top-right of the board) — folds the chain to the strip,
  // freeing the vertical real estate once tuning is done (mirrors the amp).
  // Shares the unified `.collapse-chev` style + aria-expanded pattern with the
  // amp chevron and the preset-browser collapse control.
  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'board-collapse-btn collapse-chev';
  collapseBtn.title = 'Collapse pedalboard';
  collapseBtn.setAttribute('aria-label', 'Collapse pedalboard');
  collapseBtn.setAttribute('aria-expanded', 'true');
  collapseBtn.innerHTML = '<span>▴</span>';
  board.appendChild(collapseBtn);

  const strip = buildBoardStrip(units);
  const setCollapsed = (c, notify = true) => {
    wrap.classList.toggle('collapsed', c);
    if (notify) opts.onCollapse?.(c);
  };
  const expand = () => setCollapsed(false);
  strip.addEventListener('click', expand);
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); expand(); }
  });
  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(true); });
  // Programmatic collapse (transport auto-fold): same path as the UI controls
  // but silent — the dispatcher owns persistence.
  wrap.addEventListener('board-set-collapsed', (e) => setCollapsed(!!(e.detail && e.detail.collapsed), false));

  wrap.append(strip, board);
  container.appendChild(wrap);
}
