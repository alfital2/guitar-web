// src/chain-ui/amp.js
import { createKnob } from './knob.js';

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

// Black numbered knobs for the amp panel; arc follows the theme accent (no
// inline stroke), pointer is white, with an engraved 0..10 number ring.
const AMP_KNOB_STYLE = { cap: ['#3a3a40', '#1a1a1e', '#08080a'], pointer: '#f4f4f6', numbered: true };

// Friendly captured-amp names for the neural amp head's model <select>. Index
// order matches MODELS in src/effects/neuralamp.js: ['jcm','5153','deluxe','ac10','jc'].
const NEURAL_LABELS = ['Marshall JCM', 'EVH 5153', 'Fender Deluxe', 'Vox AC10', 'Roland JC'];

// Read-only "value strip" shown when the amp is collapsed: one slim brushed-metal
// row of label + current value per knob, grouped by amp section. Built from the
// freshly-rendered head so values + formatting always match the live knobs.
function buildStrip(head) {
  const strip = el('div', 'amp-vstrip');
  const groups = [...head.querySelectorAll('.amp-group')];
  groups.forEach((g, gi) => {
    if (gi > 0) strip.appendChild(el('div', 'amp-vstrip-div'));
    const sec = el('div', 'amp-vstrip-sec');
    const sh = el('div', 'amp-vstrip-sec-head');
    sh.textContent = (g.querySelector('.amp-group-head') || {}).textContent || '';
    const chips = el('div', 'amp-vstrip-chips');
    g.querySelectorAll('.amp-knob').forEach((k) => {
      const c = el('div', 'amp-vstrip-chip');
      const v = el('div', 'amp-vstrip-val');
      v.textContent = (k.querySelector('.val') || {}).textContent || '';
      const l = el('div', 'amp-vstrip-lbl');
      l.textContent = (k.querySelector('.amp-knob-label') || {}).textContent || '';
      c.append(v, l);
      chips.appendChild(c);
    });
    sec.append(sh, chips);
    strip.appendChild(sec);
  });
  const exp = el('div', 'amp-vstrip-exp');
  exp.innerHTML = '<span>TUNE TO EDIT</span><span class="amp-vstrip-chev">▾</span>';
  strip.appendChild(exp);
  return strip;
}

// Copy current knob values from the head into the strip (by index) so the strip
// is accurate when re-collapsing after edits.
function syncStrip(strip, head) {
  const vals = [...head.querySelectorAll('.amp-knob .val')];
  [...strip.querySelectorAll('.amp-vstrip-val')].forEach((cell, i) => {
    if (vals[i]) cell.textContent = vals[i].textContent;
  });
}

export function renderAmp(container, modules, onParamChange, opts = {}) {
  container.innerHTML = '';
  if (!modules.length) return;

  const collapsed = opts.collapsed !== false; // default collapsed
  const wrap = el('div', 'amp-wrap' + (collapsed ? ' collapsed' : ''));

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

    // Neural amp head: the 'model' param is a discrete captured-amp chooser, so
    // it renders as a <select> (not a sweepable knob). It sits between the group
    // head and the Trim/Level knob row and fires the SAME onParamChange handler.
    const modelParam = m.type === 'neuralamp' ? m.schema.params.find((p) => p.key === 'model') : null;
    group.appendChild(gh);
    if (modelParam) {
      const sel = el('select', 'amp-model-select');
      sel.setAttribute('aria-label', modelParam.label);
      NEURAL_LABELS.forEach((name, i) => {
        const o = el('option');
        o.value = String(i);
        o.textContent = name;
        sel.appendChild(o);
      });
      sel.value = String(m.params[modelParam.key] ?? modelParam.default);
      sel.addEventListener('change', () => onParamChange(m.instanceId, modelParam.key, Number(sel.value)));
      group.appendChild(sel);
    }

    for (const p of m.schema.params) {
      if (p === modelParam) continue; // rendered as the <select> above
      const slot = el('div', 'amp-knob');
      const { el: kEl } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(m.instanceId, p.key, v), 44, AMP_KNOB_STYLE);
      const lbl = el('div', 'amp-knob-label');
      lbl.textContent = p.label;
      slot.append(kEl, lbl);
      row.appendChild(slot);
    }
    group.appendChild(row);
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

  // Collapse chevron (top-right of the head) — folds the amp back to the strip.
  const collapseBtn = el('button', 'amp-collapse-btn');
  collapseBtn.type = 'button';
  collapseBtn.title = 'Collapse amp to value strip';
  collapseBtn.setAttribute('aria-label', 'Collapse amp');
  collapseBtn.innerHTML = '<span>▴</span>';

  head.append(handle, panel, grille, ...corners, collapseBtn);

  // Collapsed value strip; tap anywhere (or the "TUNE TO EDIT" affordance) to expand.
  const strip = buildStrip(head);

  const setCollapsed = (c) => {
    if (c) syncStrip(strip, head);
    wrap.classList.toggle('collapsed', c);
    if (opts.onCollapse) opts.onCollapse(c);
  };
  strip.addEventListener('click', () => setCollapsed(false));
  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(true); });

  wrap.append(strip, head);
  container.appendChild(wrap);
}
