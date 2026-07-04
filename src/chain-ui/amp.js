// src/chain-ui/amp.js
import { createKnob } from './knob.js';
import { MODELS } from '../effects/neuralamp.js';
import { animateCollapse } from './collapse.js';

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

// SVG-needle VU output meter shown on the right of the amp strip. The needle is
// rotated by the ~13 Hz meter loop in main.js (transform: rotate() + an 80ms CSS
// transition for ballistics — see .amp-vu-needle). Purely a readout; no audio.
const VU_NS = 'http://www.w3.org/2000/svg';
function svg(name, attrs) { const e = document.createElementNS(VU_NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function buildVU() {
  const wrap = el('div', 'amp-vu');
  const s = svg('svg', { viewBox: '0 0 120 80', class: 'amp-vu-svg' });
  // Recessed dial face + scale arc.
  s.appendChild(svg('rect', { x: '2', y: '2', width: '116', height: '76', rx: '7', class: 'amp-vu-bg' }));
  s.appendChild(svg('path', { d: 'M 22 62 A 44 44 0 0 1 98 62', class: 'amp-vu-arc' }));
  // Tick marks across the sweep (−50°…+50°); the last three read "hot".
  for (let i = 0; i <= 10; i++) {
    const ang = (-50 + i * 10) * Math.PI / 180;
    const cx = 60, cy = 66, r0 = 40, r1 = 46;
    const sx = cx + r0 * Math.sin(ang), sy = cy - r0 * Math.cos(ang);
    const ex = cx + r1 * Math.sin(ang), ey = cy - r1 * Math.cos(ang);
    s.appendChild(svg('line', {
      x1: sx.toFixed(1), y1: sy.toFixed(1), x2: ex.toFixed(1), y2: ey.toFixed(1),
      class: 'amp-vu-tick' + (i >= 8 ? ' hot' : ''),
    }));
  }
  // Needle — rotated in place about the pivot by the meter loop.
  const needle = svg('g', { class: 'amp-vu-needle' });
  needle.appendChild(svg('line', { x1: '60', y1: '66', x2: '60', y2: '22', class: 'amp-vu-hand' }));
  needle.appendChild(svg('circle', { cx: '60', cy: '66', r: '4', class: 'amp-vu-hub' }));
  s.appendChild(needle);
  wrap.appendChild(s);
  const peak = el('span', 'amp-vu-peak');
  const label = el('div', 'amp-vu-label');
  label.textContent = 'VU';
  wrap.append(peak, label);
  // Bezel screws: the meter is bolted through the faceplate, not floating on
  // it. Same slotted-screw treatment as the panel corners, smaller, and again
  // every slot at its own angle.
  [['tl', 37], ['tr', -52], ['bl', 67], ['br', 9]].forEach(([pos, deg]) => {
    const sc = el('i', `amp-screw amp-vu-screw amp-screw-${pos}`);
    sc.style.setProperty('--slot', `${deg}deg`);
    wrap.appendChild(sc);
  });
  return wrap;
}

// One-time window listeners that drive the amp head's tube warm-up state from
// neuralamp.js CustomEvents. Registered lazily (only once a neural head renders)
// and query the live .amp-head at event time, so they survive amp re-renders.
let warmupWired = false;
function wireWarmup() {
  if (warmupWired || typeof window === 'undefined') return;
  warmupWired = true;
  const head = () => document.querySelector('.amp-head');
  // Offline-tagged events come from silent loudness-measurement renders
  // (normalize.js), not the live amp — they must not flash the warm-up UI.
  const live = (e) => !(e && e.detail && e.detail.offline);
  window.addEventListener('neural-amp-loading', (e) => {
    if (!live(e)) return;
    const h = head(); if (!h) return;
    h.classList.add('amp-warming'); h.classList.remove('amp-ready', 'amp-errored');
  });
  window.addEventListener('neural-amp-ready', (e) => {
    if (!live(e)) return;
    const h = head(); if (!h) return;
    h.classList.remove('amp-warming', 'amp-errored'); h.classList.add('amp-ready');
  });
  window.addEventListener('neural-amp-error', (e) => {
    if (!live(e)) return;
    const h = head(); if (!h) return;
    h.classList.remove('amp-warming', 'amp-ready'); h.classList.add('amp-errored');
  });
}

// Black numbered knobs for the amp panel; arc follows the theme accent (no
// inline stroke), pointer is white, with an engraved 0..10 number ring.
const AMP_KNOB_STYLE = { cap: ['#3a3a40', '#1a1a1e', '#08080a'], pointer: '#f4f4f6', numbered: true };

// Read-only "value strip" shown when the amp is collapsed: one slim brushed-metal
// row of label + current value per knob, grouped by amp section. Built from the
// freshly-rendered head so values + formatting always match the live knobs.
function buildStrip(head) {
  const strip = el('div', 'amp-vstrip');
  // Expand affordance: same semantics as the board strip + preset browser —
  // keyboard-focusable, aria-expanded reflects the (collapsed) panel state.
  strip.setAttribute('role', 'button');
  strip.setAttribute('tabindex', '0');
  strip.setAttribute('aria-expanded', 'false');
  strip.setAttribute('aria-label', 'Expand amp to edit');
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
  exp.innerHTML = '<span>TAP TO EDIT</span><span class="amp-vstrip-chev">▾</span>';
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

  // Neural amp head → a per-model faceplate theme (black tolex + gold panel for
  // the JCM, blackface navy for the Deluxe, brushed silver for the JC, …). The
  // model index maps to MODELS; switching amps visibly "swaps the amp".
  const neural = modules.find((m) => m.type === 'neuralamp');
  if (neural) {
    const idx = Math.round(Number(neural.params?.model ?? 0));
    const name = MODELS[idx] || MODELS[0];
    head.classList.add('amp-face', `amp-face-${name}`);
    wireWarmup();
  }

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

    // Neural amp head: the 'model' is chosen from the 05 Professional preset
    // browser, so it is NOT shown on the faceplate (an on-amp <select> just
    // duplicated that list). We still skip it below — it's not a sweepable knob.
    const modelParam = m.type === 'neuralamp' ? m.schema.params.find((p) => p.key === 'model') : null;
    group.appendChild(gh);

    for (const p of m.schema.params) {
      if (p === modelParam) continue; // model is preset-driven, not on the faceplate
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

  // SVG needle VU output meter, rightmost on the control panel.
  panel.appendChild(buildVU());

  // Slotted mounting screws pinning the faceplate to the cab, one per corner.
  // Each slot sits at its own angle — real screws never align once the panel
  // has been off the chassis a few times. Purely decorative (CSS in index.html).
  [['tl', 24], ['tr', -63], ['bl', 78], ['br', -11]].forEach(([pos, deg]) => {
    const s = el('i', `amp-screw amp-screw-${pos}`);
    s.style.setProperty('--slot', `${deg}deg`);
    panel.appendChild(s);
  });

  // Dark grille with glowing vacuum tubes behind a woven mesh + brand + power lamp.
  const grille = el('div', 'amp-grille');
  const tubes = el('div', 'amp-tubes');
  // Tube complement matches what the amp IS: 100 W heads (JCM, 5153) run a
  // quad; small combos (Studio analytic, Deluxe, AC10) a pair; the Roland JC
  // is famously SOLID-STATE — no bottles at all, just the clean grille.
  const TUBE_COUNT = { jcm: 4, '5153': 4, deluxe: 2, ac10: 2, jc: 0, twin: 4, mig50: 2, orange: 2, dumble: 2, ampeg: 2 };
  const neuralName = neural ? (MODELS[Math.round(Number(neural.params?.model ?? 0))] || MODELS[0]) : null;
  const nTubes = neural ? TUBE_COUNT[neuralName] ?? 2 : 2;
  tubes.innerHTML = '<i class="amp-tube"></i>'.repeat(nTubes);
  if (!nTubes) tubes.classList.add('no-tubes'); // solid-state: no chassis shelf either
  const mesh = el('div', 'amp-mesh');
  const logo = el('div', 'amp-logo');
  logo.textContent = 'Studio';
  const power = el('div', 'amp-power');
  power.innerHTML = '<span class="amp-led"></span><span>POWER</span>';
  grille.append(tubes, mesh, logo, power);

  const corners = ['tl', 'tr', 'bl', 'br'].map((c) => el('div', `amp-corner amp-corner-${c}`));

  // Collapse chevron (top-right of the head) — folds the amp back to the strip.
  // Shares the unified `.collapse-chev` style + aria-expanded pattern with the
  // board chevron and the preset-browser collapse control.
  const collapseBtn = el('button', 'amp-collapse-btn collapse-chev');
  collapseBtn.type = 'button';
  collapseBtn.title = 'Collapse amp to value strip';
  collapseBtn.setAttribute('aria-label', 'Collapse amp');
  collapseBtn.setAttribute('aria-expanded', 'true');
  collapseBtn.innerHTML = '<span>▴</span>';

  // Pre-rendered amber "tube warming up" glow layer (opacity-animated via CSS
  // when the head carries .amp-warming). Only meaningful for neural heads.
  const warmGlow = neural ? el('div', 'amp-warm-glow') : null;

  head.append(handle, panel, grille, ...corners, collapseBtn);
  if (warmGlow) head.appendChild(warmGlow);

  // Collapsed value strip; tap anywhere (or the "TAP TO EDIT" affordance) to expand.
  const strip = buildStrip(head);

  head.inert = collapsed; strip.inert = !collapsed; // only the active body is focusable
  const setCollapsed = (c, notify = true) => {
    if (c) syncStrip(strip, head);
    animateCollapse(wrap, {
      toggle: () => { wrap.classList.toggle('collapsed', c); head.inert = c; strip.inert = !c; },
      outgoing: c ? head : strip,
      incoming: c ? strip : head,
      toCollapsed: c,
    });
    if (notify && opts.onCollapse) opts.onCollapse(c);
  };
  // Programmatic collapse (transport auto-fold): same path as the UI controls
  // (incl. the strip value sync) but silent — the dispatcher owns persistence.
  wrap.addEventListener('amp-set-collapsed', (e) => setCollapsed(!!(e.detail && e.detail.collapsed), false));
  const expand = () => setCollapsed(false);
  strip.addEventListener('click', expand);
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); expand(); }
  });
  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(true); });

  wrap.append(strip, head);
  container.appendChild(wrap);
}
