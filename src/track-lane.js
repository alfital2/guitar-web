// src/track-lane.js
// GarageBand-style multi-track lane: a column of track headers and a column of
// timeline strips (one per track), sharing a bar ruler and a single playhead.
import { drawWaveform } from './waveform.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const BAR_W = 64;        // px per bar
export const PX_PER_SEC = 32;   // 1 bar (2s @ 120 BPM 4/4) = 64px → 32 px/sec
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

// Pointer-drag a clip horizontally to move it (with any other selected clips);
// drag out of the lane to delete the selection. Alt bypasses snap.
function enableClipDrag(clip, trackId, take, handlers, getStrip, root) {
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
      const moves = drag.items.map((it) => ({ trackId: +it.trackId, n: +it.n, x: Math.max(0, it.origLeft + dx) }));
      if (handlers.onMoveClips) handlers.onMoveClips(moves, e.altKey);
      else if (handlers.onMoveClip) moves.forEach((m) => handlers.onMoveClip(m.trackId, m.n, m.x, e.altKey));
    }
    drag = null;
  });
  clip.addEventListener('pointercancel', () => { if (drag) drag.items.forEach((it) => it.el.classList.remove('dragging', 'will-delete')); drag = null; const s = getStrip(); if (s) s.classList.remove('removing'); });
}

// Drag a clip's left/right edge to trim it (non-destructive: offset + len).
// Left edge moves the start into the take + shifts the clip; right edge changes
// the visible length. Commits via handlers.onTrimClip on release.
function enableClipTrim(handle, side, clip, trackId, take, handlers, getStrip) {
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation(); // edge = trim, not move/select
    const len = take.len != null ? take.len : (take.duration || 0);
    drag = { startX: e.clientX, x0: take.x || 0, off0: take.offset || 0, len0: len, dur: take.duration || 0, res: null };
    clip.classList.add('trimming');
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dxSec = (e.clientX - drag.startX) / PX_PER_SEC;
    let off = drag.off0, len = drag.len0, x = drag.x0;
    if (side === 'r') {
      len = Math.max(0.05, Math.min(drag.dur - drag.off0, drag.len0 + dxSec)); // can't exceed recorded tail
    } else {
      const newOff = Math.max(0, Math.min(drag.off0 + drag.len0 - 0.05, drag.off0 + dxSec)); // can't pass right edge
      const delta = newOff - drag.off0;
      off = newOff; len = drag.len0 - delta; x = drag.x0 + delta * PX_PER_SEC;
    }
    drag.res = { off, len, x };
    clip.style.left = `${Math.round(x)}px`;
    clip.style.width = `${Math.max(8, Math.round(len * PX_PER_SEC))}px`;
  });
  const end = () => {
    if (!drag) return;
    clip.classList.remove('trimming');
    const r = drag.res;
    if (r && handlers.onTrimClip) handlers.onTrimClip(trackId, take.n, r.off, r.len, Math.round(r.x));
    drag = null;
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', () => { drag = null; clip.classList.remove('trimming'); });
}

function trackHeader(track, armedId, h) {
  const header = el('div', 'track-header' + (track.id === armedId ? ' armed' : ''));
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
  tracks = [], bars = 16, armedId, snap = true, playheadSec = 0,
  onAddTrack, onRemoveTrack, onArm, onRename, onToggleSnap, onMoveClip, onDeleteClip, onMoveClips, onDeleteClips, onTrimClip,
  onMute, onSolo, onVolume, onPan,
} = {}) {
  container.innerHTML = '';
  const row = el('div', 'track-lane-row');
  const handlers = { onArm, onRename, onRemoveTrack, onMoveClip, onDeleteClip, onMoveClips, onDeleteClips, onTrimClip, onMute, onSolo, onVolume, onPan, rowH: ROW_H };

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
  for (let i = 1; i <= bars; i++) { const c = el('div', 'track-bar'); c.textContent = String(i); ruler.appendChild(c); }
  scroll.appendChild(ruler);

  for (const t of tracks) {
    const strip = el('div', 'track-strip');
    strip.dataset.trackId = String(t.id);
    strip.style.height = `${ROW_H}px`;
    for (const take of t.takes) {
      const len = take.len != null ? take.len : (take.duration || 0);
      const off = take.offset || 0;
      const w = Math.max(8, Math.round(len * PX_PER_SEC));
      const clip = el('div', 'track-clip');
      clip.dataset.trackId = String(t.id);
      clip.dataset.takeId = String(take.n);
      clip.style.left = `${take.x || 0}px`;
      clip.style.width = `${w}px`;
      const lbl = el('div', 'clip-label'); lbl.textContent = `${take.name || t.name || 'Take'} #${take.n}`;
      const canvas = el('canvas', 'clip-wave'); canvas.width = w; canvas.height = CLIP_H;
      clip.append(lbl, canvas);
      // Edge handles for trimming (drag to resize); they sit above the move area.
      const trimL = el('div', 'clip-trim clip-trim-l');
      const trimR = el('div', 'clip-trim clip-trim-r');
      clip.append(trimL, trimR);
      strip.appendChild(clip);
      if (take.samples) {
        const sr = take.sampleRate || 44100;
        const s0 = Math.max(0, Math.floor(off * sr));
        const s1 = Math.min(take.samples.length, Math.floor((off + len) * sr));
        const view = (s0 > 0 || s1 < take.samples.length) ? take.samples.subarray(s0, s1) : take.samples;
        drawWaveform(canvas, view, { color: WAVE_COLOR });
      }
      enableClipDrag(clip, t.id, take, handlers, () => strip, scroll);
      enableClipTrim(trimL, 'l', clip, t.id, take, handlers, () => strip);
      enableClipTrim(trimR, 'r', clip, t.id, take, handlers, () => strip);
    }
    scroll.appendChild(strip);
  }

  // Click empty timeline space (no modifier) clears the selection.
  scroll.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.track-clip')) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (selection.size) { selection.clear(); applySelection(scroll); }
  });

  const playhead = el('div', 'track-playhead');
  playhead.style.left = `${playheadSec * PX_PER_SEC}px`; // preserve position across re-renders
  playhead.appendChild(el('div', 'playhead-grip'));
  scroll.appendChild(playhead);

  timeline.appendChild(scroll);
  row.append(headers, timeline);
  container.appendChild(row);
  applySelection(scroll); // restore selection highlight after the rebuild
}
