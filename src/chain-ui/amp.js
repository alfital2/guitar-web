// src/chain-ui/amp.js
import { createKnob } from './knob.js';

export function renderAmp(container, modules, onParamChange) {
  container.innerHTML = '';
  const amp = document.createElement('div');
  amp.className = 'amp';

  const grille = document.createElement('div');
  grille.className = 'amp-grille';
  const badge = document.createElement('div');
  badge.className = 'amp-badge';
  badge.textContent = 'GTR · STUDIO';
  grille.appendChild(badge);

  const panel = document.createElement('div');
  panel.className = 'amp-panel';
  modules.forEach((m, i) => {
    const sec = document.createElement('div');
    sec.className = 'amp-section';
    const lbl = document.createElement('div');
    lbl.className = 'amp-section-label';
    lbl.textContent = m.schema.label;
    const knobs = document.createElement('div');
    knobs.className = 'amp-knobs';
    for (const p of m.schema.params) {
      const { el } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(i, p.key, v));
      knobs.appendChild(el);
    }
    sec.append(lbl, knobs);
    panel.appendChild(sec);
  });

  amp.append(grille, panel);
  container.appendChild(amp);
}
