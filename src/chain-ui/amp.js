// src/chain-ui/amp.js
import { createKnob } from './knob.js';

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

// Black numbered knobs for the amp panel; arc follows the theme accent (no
// inline stroke), pointer is white, with an engraved 0..10 number ring.
const AMP_KNOB_STYLE = { cap: ['#3a3a40', '#1a1a1e', '#08080a'], pointer: '#f4f4f6', numbered: true };

export function renderAmp(container, modules, onParamChange) {
  container.innerHTML = '';
  if (!modules.length) return;

  const head = el('div', 'amp-head');

  // Leather carry handle on the top edge.
  const handle = el('div', 'amp-handle');
  handle.innerHTML = '<span class="amp-handle-mount"></span><span class="amp-handle-strap"></span><span class="amp-handle-mount"></span>';

  // Brushed-metal control panel with one engraved group per amp module.
  const panel = el('div', 'amp-panel');
  modules.forEach((m) => {
    const group = el('div', 'amp-group');
    const gh = el('div', 'amp-group-head');
    gh.textContent = m.schema.label;
    const row = el('div', 'amp-group-knobs');
    for (const p of m.schema.params) {
      const slot = el('div', 'amp-knob');
      const { el: kEl } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(m.instanceId, p.key, v), 44, AMP_KNOB_STYLE);
      const lbl = el('div', 'amp-knob-label');
      lbl.textContent = p.label;
      slot.append(kEl, lbl);
      row.appendChild(slot);
    }
    group.append(gh, row);
    panel.appendChild(group);
  });

  // Silver grille cloth with brand script + power lamp.
  const grille = el('div', 'amp-grille');
  const logo = el('div', 'amp-logo');
  logo.textContent = 'Studio';
  const power = el('div', 'amp-power');
  power.innerHTML = '<span class="amp-led"></span><span>POWER</span>';
  grille.append(logo, power);

  const corners = ['tl', 'tr', 'bl', 'br'].map((c) => el('div', `amp-corner amp-corner-${c}`));

  head.append(handle, panel, grille, ...corners);
  container.appendChild(head);
}
