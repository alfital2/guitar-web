// src/track-lane.js
// GarageBand-style multi-track lane: a column of track headers and a column of
// timeline strips (one per track), sharing a bar ruler and a single playhead.
import { drawWaveform } from './waveform.js';
import { attachGlassThumb } from './chain-ui/glass-thumb.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const BAR_W = 64;        // px per bar
export const PX_PER_SEC = 32;   // 1 bar (2s @ 120 BPM 4/4) = 64px → 32 px/sec
const CLIP_H = 80;              // clip/canvas height in px
const ROW_H = 124;              // track row height (header + strip)
const RULER_H = 22;
const WAVE_COLOR = '#d8daf8';   // light lavender (retained from GarageBand)

// Pointer-drag a clip horizontally to move it; drag it out of the lane to delete.
function enableClipDrag(clip, trackId, take, handlers, getStrip) {
  if (!handlers || (!handlers.onMoveClip && !handlers.onDeleteClip)) return;
  let drag = null;
  const outside = (e) => { const r = getStrip().getBoundingClientRect(); return e.clientY < r.top - 30 || e.clientY > r.bottom + 30; };
  clip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { startX: e.clientX, origLeft: take.x || 0, left: take.x || 0 };
    clip.classList.add('dragging');
    try { clip.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault(); e.stopPropagation();
  });
  clip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.left = Math.max(0, drag.origLeft + (e.clientX - drag.startX));
    clip.style.left = `${drag.left}px`;
    const out = outside(e);
    clip.classList.toggle('will-delete', out);
    getStrip().classList.toggle('removing', out);
  });
  clip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const out = outside(e);
    getStrip().classList.remove('removing');
    clip.classList.remove('dragging', 'will-delete');
    if (out && handlers.onDeleteClip) handlers.onDeleteClip(trackId, take.n);
    else if (handlers.onMoveClip) handlers.onMoveClip(trackId, take.n, drag.left, e.ctrlKey);
    drag = null;
  });
  clip.addEventListener('pointercancel', () => { drag = null; clip.classList.remove('dragging', 'will-delete'); const s = getStrip(); if (s) s.classList.remove('removing'); });
}

function trackHeader(track, armedId, h) {
  const header = el('div', 'track-header' + (track.id === armedId ? ' armed' : ''));
  const top = el('div', 'track-head-top');
  top.append(el('span', 'track-icon', '▤'), (() => { const n = el('span', 'track-name'); n.textContent = track.name || '—'; return n; })());

  const ctrls = el('div', 'track-ctrls');
  const mute = el('button', 'track-ctrl track-mute' + (track.mute ? ' on' : '')); mute.type = 'button'; mute.textContent = 'M'; mute.title = 'Mute'; mute.setAttribute('aria-label', 'Mute');
  if (h.onMute) mute.addEventListener('click', () => h.onMute(track.id));
  const solo = el('button', 'track-ctrl track-solo' + (track.solo ? ' on' : '')); solo.type = 'button'; solo.textContent = 'S'; solo.title = 'Solo'; solo.setAttribute('aria-label', 'Solo');
  if (h.onSolo) solo.addEventListener('click', () => h.onSolo(track.id));
  const mon = el('button', 'track-ctrl track-monitor'); mon.type = 'button'; mon.disabled = true; mon.textContent = '\u{1F3A7}'; mon.title = 'Monitor — coming soon'; mon.setAttribute('aria-label', 'Monitor');
  const arm = el('button', 'track-ctrl track-rec' + (track.id === armedId ? ' on' : '')); arm.type = 'button'; arm.textContent = '●'; arm.title = 'Record-enable'; arm.setAttribute('aria-label', 'Record-enable');
  if (h.onArm) arm.addEventListener('click', () => h.onArm(track.id));
  ctrls.append(mute, solo, mon, arm);

  const rm = el('button', 'track-remove'); rm.type = 'button'; rm.textContent = '✕'; rm.title = 'Remove track'; rm.setAttribute('aria-label', 'Remove track');
  if (h.onRemoveTrack) rm.addEventListener('click', () => h.onRemoveTrack(track.id));

  const mix = el('div', 'track-mix');
  const vol = el('input', 'track-vol'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01';
  vol.value = String(track.volume == null ? 0.8 : track.volume); vol.setAttribute('aria-label', 'Track volume');
  // Paint the accent fill to the left of the thumb (the right stays neutral).
  const paintVol = () => vol.style.setProperty('--fill', `${parseFloat(vol.value) * 100}%`);
  paintVol();
  vol.addEventListener('input', () => { paintVol(); if (h.onVolume) h.onVolume(track.id, parseFloat(vol.value)); });
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
  attachGlassThumb(vol);

  const vlabel = el('span', 'mix-label', 'VOL');
  const plabel = el('span', 'mix-label', 'PAN');
  mix.insertBefore(vlabel, mix.firstChild);
  mix.insertBefore(plabel, pan);

  header.append(rm, top, ctrls, mix);
  header.style.height = `${h.rowH}px`;
  return header;
}

export function renderTrackLane(container, {
  tracks = [], bars = 16, armedId, snap = true,
  onAddTrack, onRemoveTrack, onArm, onToggleSnap, onMoveClip, onDeleteClip,
  onMute, onSolo, onVolume, onPan,
} = {}) {
  container.innerHTML = '';
  const row = el('div', 'track-lane-row');
  const handlers = { onArm, onRemoveTrack, onMoveClip, onDeleteClip, onMute, onSolo, onVolume, onPan, rowH: ROW_H };

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
      const w = Math.max(8, Math.round((take.duration || 0) * PX_PER_SEC));
      const clip = el('div', 'track-clip');
      clip.dataset.trackId = String(t.id);
      clip.dataset.takeId = String(take.n);
      clip.style.left = `${take.x || 0}px`;
      clip.style.width = `${w}px`;
      const lbl = el('div', 'clip-label'); lbl.textContent = `${take.name || t.name || 'Take'} #${take.n}`;
      const canvas = el('canvas', 'clip-wave'); canvas.width = w; canvas.height = CLIP_H;
      clip.append(lbl, canvas);
      strip.appendChild(clip);
      if (take.samples) drawWaveform(canvas, take.samples, { color: WAVE_COLOR });
      enableClipDrag(clip, t.id, take, handlers, () => strip);
    }
    scroll.appendChild(strip);
  }

  const playhead = el('div', 'track-playhead');
  playhead.appendChild(el('div', 'playhead-grip'));
  scroll.appendChild(playhead);

  timeline.appendChild(scroll);
  row.append(headers, timeline);
  container.appendChild(row);
}
