// src/profile-card/ui.js
import { STAT_ORDER } from './attributes.js';
import { radarPoints } from './radar.js';

const LABELS = { body: 'Body', warmth: 'Warmth', mids: 'Mids', presence: 'Presence', brightness: 'Brightness', air: 'Air' };
const NS = 'http://www.w3.org/2000/svg';

export function renderProfileCard(container, { name, stats, archetype }) {
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'tone-card';

  const nameEl = document.createElement('div'); nameEl.className = 'tc-name'; nameEl.textContent = name;
  const archEl = document.createElement('div'); archEl.className = 'tc-archetype'; archEl.textContent = archetype;

  const size = 132, cx = 66, cy = 66, R = 50;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));

  const gridPts = radarPoints(Object.fromEntries(STAT_ORDER.map((k) => [k, 100])), cx, cy, R);
  const grid = document.createElementNS(NS, 'polygon');
  grid.setAttribute('points', gridPts.map((p) => `${p.x},${p.y}`).join(' '));
  grid.setAttribute('class', 'tc-grid');
  svg.appendChild(grid);

  const poly = document.createElementNS(NS, 'polygon');
  const pts = radarPoints(stats, cx, cy, R);
  poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
  poly.setAttribute('class', 'tc-poly');
  svg.appendChild(poly);

  const list = document.createElement('div'); list.className = 'tc-stats';
  for (const k of STAT_ORDER) {
    const row = document.createElement('div'); row.className = 'tc-stat';
    const label = document.createElement('span'); label.textContent = LABELS[k];
    const val = document.createElement('b'); val.textContent = String(stats[k]);
    row.append(label, val);
    list.appendChild(row);
  }

  const body = document.createElement('div'); body.className = 'tc-body';
  body.append(svg, list);

  card.append(nameEl, archEl, body);
  container.appendChild(card);
}
