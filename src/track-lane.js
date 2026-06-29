// src/track-lane.js
// Step 1: GarageBand-style track lane scaffold — a track header (preset name +
// inert controls) and an empty timeline (numbered bar ruler + playhead). No
// audio yet; later steps add capture, waveform clips, and playback.
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export function renderTrackLane(container, { presetName, bars = 16 } = {}) {
  container.innerHTML = '';
  const row = el('div', 'track-lane-row');

  // ── Header ──
  const header = el('div', 'track-header');
  const top = el('div', 'track-head-top');
  const icon = el('span', 'track-icon', '▤'); // small amp-ish glyph
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
  const playhead = el('div', 'track-playhead');
  const scroll = el('div', 'track-scroll');
  scroll.append(ruler, area, playhead);
  timeline.appendChild(scroll);

  row.append(header, timeline);
  container.appendChild(row);
}
