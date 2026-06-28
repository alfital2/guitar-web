// src/chain-ui/amp.js
import { createKnob } from './knob.js';

export function renderAmp(container, modules, onParamChange) {
  container.innerHTML = '';
  if (!modules.length) return;

  const wood = document.createElement('div');
  wood.className = 'amp-wood';

  const amp = document.createElement('div');
  amp.className = 'amp';

  const grille = document.createElement('div');
  grille.className = 'amp-grille';
  const badge = document.createElement('div');
  badge.className = 'amp-badge';
  badge.textContent = 'GTR · STUDIO';
  const power = document.createElement('div');
  power.className = 'amp-power';
  const led = document.createElement('div');
  led.className = 'amp-led';
  const powerLbl = document.createElement('span');
  powerLbl.textContent = 'POWER';
  power.append(led, powerLbl);
  grille.append(badge, power);

  const panel = document.createElement('div');
  panel.className = 'amp-panel';
  modules.forEach((m) => {
    const sec = document.createElement('div');
    sec.className = 'amp-section';
    const lbl = document.createElement('div');
    lbl.className = 'amp-section-label';
    lbl.textContent = m.schema.label;
    const knobs = document.createElement('div');
    knobs.className = 'amp-knobs';
    for (const p of m.schema.params) {
      const { el } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(m.instanceId, p.key, v), false);
      knobs.appendChild(el);
    }
    sec.append(lbl, knobs);
    panel.appendChild(sec);
  });

  amp.append(grille, panel);
  container.append(wood, amp);
}
