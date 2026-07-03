// src/track-lane.js
// GarageBand-style multi-track lane: a column of track headers and a column of
// timeline strips (one per track), sharing a bar ruler and a single playhead.
import { drawWaveform } from './waveform.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const BAR_W = 64;        // px per bar at 120 BPM 4/4 (legacy default)
export const PX_PER_SEC = 32;   // pixels per real second (constant density)
export const BEATS_PER_BAR = 4; // 4/4 time

// The ruler grid is derived from TEMPO so it matches the playhead, which
// advances in real seconds (playheadSec * PX_PER_SEC). At 120 BPM a bar is 2s =
// 64px; at 80 BPM a bar is 3s = 96px. Hardcoding 64px (the old bug) made the
// ruler disagree with the metronome at any tempo other than 120.
export function beatPx(bpm) { return (60 / (bpm || 120)) * PX_PER_SEC; }
export function barPx(bpm) { return BEATS_PER_BAR * beatPx(bpm); }

// ── View zoom ───────────────────────────────────────────────────────────────
// A pure VIEW multiplier for precise editing: every rendered px is model-px ×
// Z, every pointer delta is divided by Z on the way back in. Take positions
// (`x`) and all committed handler values stay in BASE px (PX_PER_SEC), so
// zooming never moves audio and snap stays on the musical grid.
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
let Z = 1; // set by renderTrackLane from opts.zoom; gestures read it live
const CLIP_H = 80;              // clip/canvas height in px
const ROW_H = 124;              // track row height (header + strip)
const RULER_H = 22;
const WAVE_COLOR = '#d8daf8';   // light lavender (retained from GarageBand)

// ── Multi-clip selection (survives re-renders; one lane on the page) ──
// Keys are "trackId:takeN". Cmd/Ctrl+click toggles a clip; a plain click selects
// just that clip. Dragging any selected clip moves the whole selection together.
const selection = new Set();
const clipKey = (trackId, n) => `${trackId}:${n}`;
function applySelection(root) {
  root.querySelectorAll('.track-clip').forEach((c) => {
    c.classList.toggle('selected', selection.has(clipKey(c.dataset.trackId, c.dataset.takeId)));
  });
}

// Current clip selection, for callers (e.g. keyboard delete in main.js).
export function getSelectedClips() {
  return [...selection].map((k) => { const [t, n] = k.split(':'); return { trackId: +t, n: +n }; });
}
export function clearClipSelection() { selection.clear(); }

// Replace the selection with the given clips ([{trackId, n}]). Pass the lane
// container (any ancestor of the clips) to refresh the highlight in place;
// omit it when a re-render follows (renderTrackLane re-applies the highlight).
export function setClipSelection(items, container) {
  selection.clear();
  for (const it of items) selection.add(clipKey(it.trackId, it.n));
  if (container) applySelection(container);
}

// A grab this close (px) to a clip's visual edge trims instead of moving.
const TRIM_EDGE_PX = 8;
// GarageBand splits the right edge: the top of it loops, the rest trims.
const LOOP_ZONE = 0.4;      // upper fraction of the right edge that loop-drags
const LOOP_SNAP_PX = 6;     // snap distance to a whole-repetition boundary

// Loop repetitions of a take (float ≥ 1; absent/1 = no loop).
const repOf = (t) => (t.repeat && t.repeat > 1 ? t.repeat : 1);

// Pure: map a loop-handle drag of `dxPx` pixels on a clip whose window is
// `lenSec` seconds (starting at `rep0` repetitions) to the new repeat value.
// Snaps to whole repetitions within LOOP_SNAP_PX of a boundary (GarageBand
// feel); anything below 1.05 collapses to exactly 1 (loop removed).
export function loopRepeatFromDrag(rep0, lenSec, dxPx) {
  const lenPx = lenSec * PX_PER_SEC;
  if (!(lenPx > 0)) return 1;
  let rep = Math.max(1, (rep0 * lenPx + dxPx) / lenPx);
  const whole = Math.round(rep);
  if (whole >= 1 && Math.abs(rep - whole) * lenPx <= LOOP_SNAP_PX) rep = whole;
  return rep < 1.05 ? 1 : rep;
}

// Pointer-drag a clip horizontally to move it (with any other selected clips);
// drag out of the lane to delete the selection. Alt bypasses snap.
// Grabs within ~8px of a clip edge fall through to trim (`beginTrim`): the CSS
// trim handles cannot reach the clip's 1px border pixel (overflow:hidden clips
// children to the padding box), so a grab on the exact edge line would
// otherwise land on the move surface and drag the whole clip.
function enableClipDrag(clip, trackId, take, handlers, getStrip, root, beginTrim) {
  let drag = null;
  const outside = (e) => { const r = getStrip().getBoundingClientRect(); return e.clientY < r.top - 30 || e.clientY > r.bottom + 30; };
  clip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const key = clipKey(trackId, take.n);
    // Cmd/Ctrl+click → toggle this clip in the selection; don't start a drag.
    if (e.metaKey || e.ctrlKey) {
      if (selection.has(key)) selection.delete(key); else selection.add(key);
      applySelection(root);
      e.preventDefault(); e.stopPropagation();
      return;
    }
    // Edge grab = trim, matching the ew-resize affordance zone. The right
    // edge is split like GarageBand: its upper LOOP_ZONE loop-drags (repeat
    // the clip), the rest trims.
    if (beginTrim) {
      const r = clip.getBoundingClientRect();
      const edge = Math.min(TRIM_EDGE_PX, r.width / 3); // keep a move surface on tiny clips
      if (r.width > 0 && e.clientX - r.left < edge) { beginTrim.l(e); return; }
      if (r.width > 0 && r.right - e.clientX < edge) {
        if (beginTrim.loop && r.height > 0 && e.clientY - r.top < r.height * LOOP_ZONE) { beginTrim.loop(e); return; }
        beginTrim.r(e); return;
      }
    }
    // Plain click on an unselected clip → make it the sole selection.
    if (!selection.has(key)) { selection.clear(); selection.add(key); applySelection(root); }
    // Drag every selected clip together.
    const items = [...root.querySelectorAll('.track-clip.selected')].map((c) => ({
      el: c, trackId: c.dataset.trackId, n: c.dataset.takeId, origLeft: parseFloat(c.style.left) || 0,
    }));
    drag = { startX: e.clientX, items };
    items.forEach((it) => it.el.classList.add('dragging'));
    try { clip.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault(); e.stopPropagation();
  });
  clip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const out = outside(e);
    drag.items.forEach((it) => {
      it.el.style.left = `${Math.max(0, it.origLeft + dx)}px`;
      it.el.classList.toggle('will-delete', out);
    });
    getStrip().classList.toggle('removing', out);
  });
  clip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const out = outside(e);
    getStrip().classList.remove('removing');
    drag.items.forEach((it) => it.el.classList.remove('dragging', 'will-delete'));
    if (out) {
      const items = drag.items.map((it) => ({ trackId: +it.trackId, n: +it.n }));
      if (handlers.onDeleteClips) handlers.onDeleteClips(items);
      else if (handlers.onDeleteClip) items.forEach((it) => handlers.onDeleteClip(it.trackId, it.n));
      items.forEach((it) => selection.delete(clipKey(it.trackId, it.n)));
    } else {
      // origLeft + dx are VIEW px; handlers expect BASE (model) px.
      const moves = drag.items.map((it) => ({ trackId: +it.trackId, n: +it.n, x: Math.max(0, (it.origLeft + dx) / Z) }));
      if (handlers.onMoveClips) handlers.onMoveClips(moves, e.altKey);
      else if (handlers.onMoveClip) moves.forEach((m) => handlers.onMoveClip(m.trackId, m.n, m.x, e.altKey));
    }
    drag = null;
  });
  clip.addEventListener('pointercancel', () => { if (drag) drag.items.forEach((it) => it.el.classList.remove('dragging', 'will-delete')); drag = null; const s = getStrip(); if (s) s.classList.remove('removing'); });
}

// Drag a clip's left/right edge to trim it (non-destructive: offset + len).
// Left edge moves the start into the take + shifts the clip; right edge changes
// the visible length. Commits via handlers.onTrimClip on release. Returns the
// gesture starter so enableClipDrag can route edge grabs here even when the
// pointerdown target is the clip body (the border pixel the handles can't cover).
function enableClipTrim(handle, side, clip, trackId, take, handlers, getStrip) {
  let drag = null;
  const begin = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); // edge = trim, not move/select
    const len = take.len != null ? take.len : (take.duration || 0);
    drag = { startX: e.clientX, x0: take.x || 0, off0: take.offset || 0, len0: len, rep0: repOf(take), dur: take.duration || 0, res: null };
    clip.classList.add('trimming');
    // Capture to the handle even when `e.target` is the clip: move/up listeners
    // live on the handle, and capture retargets the rest of the gesture to it.
    try { handle.setPointerCapture(e.pointerId); } catch {}
  };
  handle.addEventListener('pointerdown', begin);
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dxSec = (e.clientX - drag.startX) / (PX_PER_SEC * Z);
    let off = drag.off0, len = drag.len0, x = drag.x0;
    if (side === 'r' && drag.rep0 > 1) {
      // Looped clip: the right edge resizes the SPAN (repeat, fractional tail
      // allowed), GarageBand-style — the base window under a loop stays intact.
      // No boundary snap here (that's the loop handle); main.js collapses < 1.05.
      const rep = Math.max(1, (drag.rep0 * drag.len0 + dxSec) / drag.len0);
      drag.res = { repeat: rep };
      clip.style.width = `${Math.max(8, Math.round(rep * drag.len0 * PX_PER_SEC * Z))}px`;
      return;
    }
    if (side === 'r') {
      len = Math.max(0.05, Math.min(drag.dur - drag.off0, drag.len0 + dxSec)); // can't exceed recorded tail
    } else {
      const newOff = Math.max(0, Math.min(drag.off0 + drag.len0 - 0.05, drag.off0 + dxSec)); // can't pass right edge
      const delta = newOff - drag.off0;
      off = newOff; len = drag.len0 - delta; x = drag.x0 + delta * PX_PER_SEC;
    }
    drag.res = { off, len, x }; // x stays in BASE px; the preview scales below
    clip.style.left = `${Math.round(x * Z)}px`;
    // A looped clip previews its full span (every repetition shares the window).
    clip.style.width = `${Math.max(8, Math.round(len * drag.rep0 * PX_PER_SEC * Z))}px`;
  });
  const end = () => {
    if (!drag) return;
    clip.classList.remove('trimming');
    const r = drag.res;
    if (r && r.repeat != null) { if (handlers.onLoopClip) handlers.onLoopClip(trackId, take.n, r.repeat); }
    else if (r && handlers.onTrimClip) handlers.onTrimClip(trackId, take.n, r.off, r.len, Math.round(r.x));
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => { drag = null; clip.classList.remove('trimming'); });
  return begin;
}

// Drag the loop handle (top of the right edge) outward to repeat the clip's
// window back to back, GarageBand style. Live preview: the width follows the
// pointer, snapping to whole repetitions near a boundary (loopRepeatFromDrag);
// commits via handlers.onLoopClip(trackId, n, repeat) on release. Only the
// `repeat` field changes — samples/offset/len are untouched.
function enableClipLoop(handle, clip, trackId, take, handlers) {
  let drag = null;
  const begin = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); // loop, not trim/move/select
    const len = take.len != null ? take.len : (take.duration || 0);
    if (!(len > 0)) return;
    drag = { startX: e.clientX, len, rep0: repOf(take), res: null };
    clip.classList.add('looping');
    // Capture to the handle even when `e.target` is the clip body (edge-zone
    // routing): move/up listeners live on the handle.
    try { handle.setPointerCapture(e.pointerId); } catch {}
  };
  handle.addEventListener('pointerdown', begin);
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const rep = loopRepeatFromDrag(drag.rep0, drag.len, (e.clientX - drag.startX) / Z);
    drag.res = rep;
    clip.style.width = `${Math.max(8, Math.round(rep * drag.len * PX_PER_SEC * Z))}px`;
  });
  const end = () => {
    if (!drag) return;
    clip.classList.remove('looping');
    if (drag.res != null && handlers.onLoopClip) handlers.onLoopClip(trackId, take.n, drag.res);
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => { drag = null; clip.classList.remove('looping'); });
  return begin;
}

function trackHeader(track, armedId, h) {
  const header = el('div', 'track-header' + (track.id === armedId ? ' armed' : ''));
  header.dataset.trackId = String(track.id); // for right-click track-menu delegation
  const top = el('div', 'track-head-top');
  const nameEl = el('span', 'track-name'); nameEl.textContent = track.name || '—'; nameEl.title = 'Click to rename';
  nameEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const inp = el('input', 'track-name-input'); inp.value = track.name || '';
    nameEl.replaceWith(inp); inp.focus(); inp.select();
    const commit = (apply) => { const v = inp.value.trim(); if (apply && v && h.onRename) h.onRename(track.id, v); else inp.replaceWith(nameEl); };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); });
    inp.addEventListener('blur', () => commit(true));
  });
  top.append(el('span', 'track-icon', '▤'), nameEl);

  const ctrls = el('div', 'track-ctrls');
  const mute = el('button', 'track-ctrl track-mute' + (track.mute ? ' on' : '')); mute.type = 'button'; mute.textContent = 'M'; mute.title = 'Mute'; mute.setAttribute('aria-label', 'Mute');
  if (h.onMute) mute.addEventListener('click', () => h.onMute(track.id));
  const solo = el('button', 'track-ctrl track-solo' + (track.solo ? ' on' : '')); solo.type = 'button'; solo.textContent = 'S'; solo.title = 'Solo'; solo.setAttribute('aria-label', 'Solo');
  if (h.onSolo) solo.addEventListener('click', () => h.onSolo(track.id));
  const mon = el('button', 'track-ctrl track-monitor'); mon.type = 'button'; mon.disabled = true; mon.textContent = '\u{1F3A7}'; mon.title = 'Monitor — coming soon'; mon.setAttribute('aria-label', 'Monitor');
  ctrls.append(mute, solo, mon);

  const rm = el('button', 'track-remove'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Remove track'; rm.setAttribute('aria-label', 'Remove track');
  if (h.onRemoveTrack) rm.addEventListener('click', () => h.onRemoveTrack(track.id));

  const mix = el('div', 'track-mix');
  const vol = el('input', 'track-vol'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
  vol.value = String(track.volume == null ? 0.8 : track.volume); vol.setAttribute('aria-label', 'Track volume');
  vol.addEventListener('input', () => { if (h.onVolume) h.onVolume(track.id, parseFloat(vol.value)); });
  const pan = el('span', 'track-pan'); pan.title = 'Pan (drag) · double-click to center';
  const panDot = el('span', 'track-pan-dot'); pan.appendChild(panDot);
  const panVal = track.pan || 0;
  panDot.style.transform = `rotate(${panVal * 135}deg)`;
  if (h.onPan) {
    let pd = null;
    pan.addEventListener('pointerdown', (e) => { pd = { x: e.clientX, v: panVal }; try { pan.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); });
    pan.addEventListener('pointermove', (e) => { if (!pd) return; const p = Math.max(-1, Math.min(1, pd.v + (e.clientX - pd.x) / 80)); panDot.style.transform = `rotate(${p * 135}deg)`; h.onPan(track.id, p); });
    pan.addEventListener('pointerup', () => { pd = null; });
    pan.addEventListener('dblclick', () => { panDot.style.transform = 'rotate(0deg)'; h.onPan(track.id, 0); });
  }
  mix.append(vol, pan);

  const vlabel = el('span', 'mix-label', 'VOL');
  const plabel = el('span', 'mix-label', 'PAN');
  mix.insertBefore(vlabel, mix.firstChild);
  mix.insertBefore(plabel, pan);

  // Click the header body (not a control/name) to arm = make this the active track.
  header.addEventListener('click', (e) => {
    if (e.target.closest('button, input, .track-pan, .track-name')) return;
    if (h.onArm) h.onArm(track.id);
  });

  header.append(rm, top, ctrls, mix);
  header.style.height = `${h.rowH}px`;
  return header;
}

export function renderTrackLane(container, {
  tracks = [], bars = 16, armedId, snap = true, playheadSec = 0, bpm = 120, zoom = 1, onZoom,
  onAddTrack, onRemoveTrack, onArm, onRename, onToggleSnap, onMoveClip, onDeleteClip, onMoveClips, onDeleteClips, onTrimClip, onLoopClip,
  onMute, onSolo, onVolume, onPan,
} = {}) {
  // Preserve the horizontal view across re-renders: remember which TIME sat at
  // the container's left edge under the OLD zoom, restore it under the new one.
  const prevTl = container.querySelector('.track-timeline');
  const prevLeftSec = prevTl ? prevTl.scrollLeft / (PX_PER_SEC * Z) : 0;
  Z = Math.max(0.5, Math.min(4, zoom || 1));
  container.innerHTML = '';
  const row = el('div', 'track-lane-row');
  const handlers = { onArm, onRename, onRemoveTrack, onMoveClip, onDeleteClip, onMoveClips, onDeleteClips, onTrimClip, onLoopClip, onMute, onSolo, onVolume, onPan, rowH: ROW_H };

  // Drop selection entries whose clip no longer exists (deleted/renumbered).
  const valid = new Set();
  for (const t of tracks) for (const take of t.takes) valid.add(clipKey(t.id, take.n));
  for (const k of [...selection]) if (!valid.has(k)) selection.delete(k);

  // ── Headers column ──
  const headers = el('div', 'track-headers');
  const addRow = el('div', 'track-add-row');
  const add = el('button', 'track-add'); add.type = 'button'; add.textContent = '＋ Track'; add.title = 'Add track'; add.setAttribute('aria-label', 'Add track');
  if (onAddTrack) add.addEventListener('click', onAddTrack);
  const snapBtn = el('button', `track-ctrl snap-toggle${snap ? ' on' : ''}`); snapBtn.id = 'snap-toggle'; snapBtn.type = 'button'; snapBtn.textContent = '▦'; snapBtn.title = 'Snap to grid'; snapBtn.setAttribute('aria-label', 'Snap to grid');
  if (onToggleSnap) snapBtn.addEventListener('click', onToggleSnap);
  addRow.append(add, snapBtn);
  addRow.style.height = `${RULER_H}px`;
  headers.appendChild(addRow);
  for (const t of tracks) headers.appendChild(trackHeader(t, armedId, handlers));

  // ── Timelines column ──
  const timeline = el('div', 'track-timeline');
  const scroll = el('div', 'track-scroll');
  const ruler = el('div', 'track-ruler');
  ruler.style.height = `${RULER_H}px`;
  // Tempo-derived bar width so bar lines fall on the real-time playhead.
  const bw = barPx(bpm) * Z;
  for (let i = 1; i <= bars; i++) {
    const c = el('div', 'track-bar'); c.textContent = String(i);
    c.style.width = `${bw}px`; c.style.flex = `0 0 ${bw}px`;
    ruler.appendChild(c);
  }
  scroll.appendChild(ruler);

  for (const t of tracks) {
    const strip = el('div', 'track-strip');
    strip.dataset.trackId = String(t.id);
    strip.style.height = `${ROW_H}px`;
    for (const take of t.takes) {
      const len = take.len != null ? take.len : (take.duration || 0);
      const off = take.offset || 0;
      const rep = repOf(take);                              // loop repetitions (1 = none)
      const baseW = Math.max(1, Math.round(len * PX_PER_SEC * Z));   // one repetition (view px)
      const w = Math.max(8, Math.round(len * rep * PX_PER_SEC * Z)); // full looped span (view px)
      const clip = el('div', 'track-clip');
      clip.dataset.trackId = String(t.id);
      clip.dataset.takeId = String(take.n);
      clip.style.left = `${Math.round((take.x || 0) * Z)}px`;
      clip.style.width = `${w}px`;
      const lbl = el('div', 'clip-label'); lbl.textContent = `${take.name || t.name || 'Take'} #${take.n}`;
      const canvas = el('canvas', 'clip-wave'); canvas.width = w; canvas.height = CLIP_H;
      clip.append(lbl, canvas);
      // Edge handles: trim on both edges, loop on the top of the right edge
      // (GarageBand). They sit above the move area; loop sits above trim.
      const trimL = el('div', 'clip-trim clip-trim-l');
      const trimR = el('div', 'clip-trim clip-trim-r');
      const loopH = el('div', 'clip-loop');
      loopH.title = 'Drag to loop';
      clip.append(trimL, trimR, loopH);
      // Boundary notches: a thin line + top tick at every repetition edge.
      for (let i = 1; i < Math.ceil(rep - 1e-9); i++) {
        const notch = el('div', 'clip-loop-notch');
        notch.style.left = `${i * baseW}px`;
        clip.appendChild(notch);
      }
      strip.appendChild(clip);
      if (take.samples) {
        const sr = take.sampleRate || 44100;
        const s0 = Math.max(0, Math.floor(off * sr));
        const s1 = Math.min(take.samples.length, Math.floor((off + len) * sr));
        const view = (s0 > 0 || s1 < take.samples.length) ? take.samples.subarray(s0, s1) : take.samples;
        if (rep > 1) {
          // Draw the window's waveform once offscreen, then tile it across the
          // looped span; the canvas edge truncates the final partial repetition.
          const tile = document.createElement('canvas');
          tile.width = baseW; tile.height = CLIP_H;
          drawWaveform(tile, view, { color: WAVE_COLOR });
          const c = canvas.getContext('2d');
          if (c) for (let x = 0; x < w; x += baseW) c.drawImage(tile, x, 0);
        } else {
          drawWaveform(canvas, view, { color: WAVE_COLOR });
        }
      }
      const beginTrim = {
        l: enableClipTrim(trimL, 'l', clip, t.id, take, handlers, () => strip),
        r: enableClipTrim(trimR, 'r', clip, t.id, take, handlers, () => strip),
        loop: enableClipLoop(loopH, clip, t.id, take, handlers),
      };
      enableClipDrag(clip, t.id, take, handlers, () => strip, scroll, beginTrim);
    }
    scroll.appendChild(strip);
  }

  // Marquee (rubber-band) select: drag on empty timeline to box-select clips,
  // like the desktop. A plain click (no drag) clears the selection; clicks on a
  // clip / ruler / playhead are left to their own handlers.
  scroll.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.track-clip') || e.target.closest('.track-ruler') || e.target.closest('.playhead-grip')) return;
    const startX = e.clientX, startY = e.clientY;
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    const base = new Set(selection);
    let box = null;
    const onMove = (ev) => {
      if (!box && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return; // drag threshold
      if (!box) { box = el('div', 'marquee'); scroll.appendChild(box); }
      const r = scroll.getBoundingClientRect();
      const x1 = Math.min(startX, ev.clientX), x2 = Math.max(startX, ev.clientX);
      const y1 = Math.min(startY, ev.clientY), y2 = Math.max(startY, ev.clientY);
      box.style.left = `${x1 - r.left + scroll.scrollLeft}px`;
      box.style.top = `${y1 - r.top + scroll.scrollTop}px`;
      box.style.width = `${x2 - x1}px`;
      box.style.height = `${y2 - y1}px`;
      const next = additive ? new Set(base) : new Set();
      scroll.querySelectorAll('.track-clip').forEach((c) => {
        const cr = c.getBoundingClientRect();
        if (cr.right >= x1 && cr.left <= x2 && cr.bottom >= y1 && cr.top <= y2) next.add(clipKey(c.dataset.trackId, c.dataset.takeId));
      });
      selection.clear(); next.forEach((k) => selection.add(k));
      applySelection(scroll);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (box) {
        box.remove();
        // Swallow the click that follows a drag so it doesn't also seek/clear.
        const swallow = (ce) => ce.stopPropagation();
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      } else if (!additive && selection.size) {
        selection.clear(); applySelection(scroll); // plain empty click clears
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  const playhead = el('div', 'track-playhead');
  playhead.style.left = `${playheadSec * PX_PER_SEC * Z}px`; // preserve position across re-renders
  playhead.appendChild(el('div', 'playhead-grip'));
  scroll.appendChild(playhead);

  timeline.appendChild(scroll);

  // ── Zoom: magnifier slider pinned to the ruler's top-right (doesn't scroll) ──
  const wrap = el('div', 'timeline-wrap');
  wrap.appendChild(timeline);
  if (onZoom) {
    const zc = el('div', 'zoom-ctl');
    zc.title = 'Timeline zoom';
    zc.innerHTML = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="10.2" y1="10.2" x2="14.2" y2="14.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const zr = el('input', 'zoom-range');
    zr.type = 'range'; zr.min = '0.5'; zr.max = '4'; zr.step = '0.05'; zr.value = String(Z);
    zr.setAttribute('aria-label', 'Timeline zoom');
    zr.addEventListener('input', () => onZoom(parseFloat(zr.value)));
    zc.appendChild(zr);
    wrap.appendChild(zc);

    // ⌘/Ctrl + wheel (and trackpad pinch, which browsers deliver as a
    // ctrlKey-tagged wheel) zooms around the pointer, only over the timeline.
    timeline.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const nz = Math.max(0.5, Math.min(4, Z * Math.exp(-e.deltaY * 0.0022)));
      if (Math.abs(nz - Z) < 0.001) return;
      const r = timeline.getBoundingClientRect();
      const cursorPx = e.clientX - r.left;
      const anchorSec = (timeline.scrollLeft + cursorPx) / (PX_PER_SEC * Z);
      onZoom(nz, { anchorSec, cursorPx });
    }, { passive: false });
  }

  row.append(headers, wrap);
  container.appendChild(row);
  // Restore the pre-render view (time at the left edge) under the new zoom.
  timeline.scrollLeft = Math.max(0, prevLeftSec * PX_PER_SEC * Z);
  applySelection(scroll); // restore selection highlight after the rebuild
}
