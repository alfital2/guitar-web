// src/track-lane.js
// GarageBand-style track lane: a track header (preset name + inert controls) and
// a timeline (numbered bar ruler + playhead) holding recorded clips.
import { drawWaveform } from './waveform.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const BAR_W = 64;        // px per bar
export const PX_PER_SEC = 32;   // 1 bar (2s @ 120 BPM 4/4) = 64px → 32 px/sec
const CLIP_H = 80;              // clip/canvas height in px
const WAVE_COLOR = '#d8daf8';   // light lavender (retained from GarageBand)

// Pointer-drag a clip horizontally to move it; drag it out of the lane to delete.
function enableClipDrag(clip, take, handlers, getArea) {
  if (!handlers || (!handlers.onMoveClip && !handlers.onDeleteClip)) return;
  let drag = null;
  const outside = (e) => { const r = getArea().getBoundingClientRect(); return e.clientY < r.top - 30 || e.clientY > r.bottom + 30; };
  clip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { startX: e.clientX, origLeft: take.x || 0, left: take.x || 0 };
    clip.classList.add('dragging');
    try { clip.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  clip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.left = Math.max(0, drag.origLeft + (e.clientX - drag.startX));
    clip.style.left = `${drag.left}px`;
    const out = outside(e);
    clip.classList.toggle('will-delete', out);
    getArea().classList.toggle('removing', out);
  });
  clip.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const out = outside(e);
    getArea().classList.remove('removing');
    clip.classList.remove('dragging', 'will-delete');
    if (out && handlers.onDeleteClip) handlers.onDeleteClip(take.n);
    else if (handlers.onMoveClip) handlers.onMoveClip(take.n, drag.left);
    drag = null;
  });
  clip.addEventListener('pointercancel', () => { drag = null; clip.classList.remove('dragging', 'will-delete'); const a = getArea(); if (a) a.classList.remove('removing'); });
}

export function renderTrackLane(container, { presetName, bars = 16, takes = [], onMoveClip, onDeleteClip } = {}) {
  container.innerHTML = '';
  const row = el('div', 'track-lane-row');

  // ── Header ──
  const header = el('div', 'track-header');
  const top = el('div', 'track-head-top');
  const icon = el('span', 'track-icon', '▤');
  const name = el('span', 'track-name');
  name.textContent = presetName || '—';
  top.append(icon, name);

  const ctrls = el('div', 'track-ctrls');
  for (const [cls, glyph, label] of [['mute', 'M', 'Mute'], ['monitor', '\u{1F3A7}', 'Monitor'], ['rec', '●', 'Record-enable']]) {
    const b = el('button', `track-ctrl track-${cls}`);
    b.type = 'button'; b.disabled = true; b.title = `${label} — available with recording`;
    b.setAttribute('aria-label', label); b.textContent = glyph;
    ctrls.appendChild(b);
  }

  const mix = el('div', 'track-mix');
  const vol = el('input', 'track-vol'); vol.type = 'range'; vol.min = '0'; vol.max = '1'; vol.step = '0.01'; vol.value = '0.8'; vol.disabled = true; vol.setAttribute('aria-label', 'Track volume');
  const pan = el('span', 'track-pan'); pan.title = 'Pan';
  mix.append(vol, pan);
  header.append(top, ctrls, mix);

  // ── Timeline ──
  const timeline = el('div', 'track-timeline');
  const ruler = el('div', 'track-ruler');
  for (let i = 1; i <= bars; i++) {
    const cell = el('div', 'track-bar');
    cell.textContent = String(i);
    ruler.appendChild(cell);
  }
  const area = el('div', 'track-area');

  // Recorded clips (purple, lavender waveform), laid by each take's x offset.
  for (const take of takes) {
    const w = Math.max(8, Math.round((take.duration || 0) * PX_PER_SEC));
    const clip = el('div', 'track-clip');
    clip.dataset.takeId = String(take.n);
    clip.style.left = `${take.x || 0}px`;
    clip.style.width = `${w}px`;
    const lbl = el('div', 'clip-label');
    lbl.textContent = `${take.name || 'Take'} #${take.n}`;
    const canvas = el('canvas', 'clip-wave');
    canvas.width = w; canvas.height = CLIP_H;
    clip.append(lbl, canvas);
    area.appendChild(clip);
    if (take.samples) drawWaveform(canvas, take.samples, { color: WAVE_COLOR });
    enableClipDrag(clip, take, { onMoveClip, onDeleteClip }, () => area);
  }

  const playhead = el('div', 'track-playhead');
  const scroll = el('div', 'track-scroll');
  scroll.append(ruler, area, playhead);
  timeline.appendChild(scroll);

  row.append(header, timeline);
  container.appendChild(row);
}
