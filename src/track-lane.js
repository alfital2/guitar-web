// src/track-lane.js
// GarageBand-style track lane: a track header (preset name + inert controls) and
// a timeline (numbered bar ruler + playhead) holding recorded clips.
import { drawWaveform } from './waveform.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export const BAR_W = 64;        // px per bar
export const PX_PER_SEC = 32;   // 1 bar (2s @ 120 BPM 4/4) = 64px → 32 px/sec
const CLIP_H = 80;              // clip/canvas height in px
const WAVE_COLOR = '#d8daf8';   // light lavender (retained from GarageBand)

export function renderTrackLane(container, { presetName, bars = 16, takes = [] } = {}) {
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
    clip.style.left = `${take.x || 0}px`;
    clip.style.width = `${w}px`;
    const lbl = el('div', 'clip-label');
    lbl.textContent = `${take.name || 'Take'} #${take.n}`;
    const canvas = el('canvas', 'clip-wave');
    canvas.width = w; canvas.height = CLIP_H;
    clip.append(lbl, canvas);
    area.appendChild(clip);
    if (take.samples) drawWaveform(canvas, take.samples, { color: WAVE_COLOR });
  }

  const playhead = el('div', 'track-playhead');
  const scroll = el('div', 'track-scroll');
  scroll.append(ruler, area, playhead);
  timeline.appendChild(scroll);

  row.append(header, timeline);
  container.appendChild(row);
}
