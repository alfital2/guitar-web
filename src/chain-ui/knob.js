// src/chain-ui/knob.js
const NS = 'http://www.w3.org/2000/svg';
let knobSeq = 0;

export function valueToAngle(value, min, max, startDeg = -135, endDeg = 135) {
  const t = max === min ? 0 : (value - min) / (max - min);
  const c = Math.max(0, Math.min(1, t));
  return startDeg + c * (endDeg - startDeg);
}

function clampSnap(v, min, max, step) {
  const snapped = Math.round((v - min) / step) * step + min;
  const fixed = Math.round(snapped * 1e6) / 1e6;
  return Math.max(min, Math.min(max, fixed));
}
function format(value, step, unit) {
  let s;
  if (Number.isInteger(step)) s = String(Math.round(value));
  else {
    const decimals = (String(step).split('.')[1] || '').length;
    s = value.toFixed(Math.min(decimals, 3));
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  }
  return unit ? `${s} ${unit}` : s;
}
function polar(cx, cy, r, deg) { const a = (deg - 90) * Math.PI / 180; return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }; }
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, endDeg), e = polar(cx, cy, r, startDeg);
  const large = Math.abs(endDeg - startDeg) <= 180 ? 0 : 1;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}
function svgEl(name, attrs) { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }

// Blend two #rrggbb colors (t = share of `other`). SVG gradients need literal
// colors, so accent-tinted ring stops are computed here rather than color-mix.
function mixHex(hex, other, t) {
  const n = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = n(hex), b = n(other);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Bezel-ring finishes (top-lit vertical sheen: crown → waist → dark → rim).
const RING_STOPS = {
  chrome: ['#f4f6f8', '#9aa0a6', '#54595f', '#c8ced3'],
  dark: ['#6a6f76', '#33363b', '#17191c', '#4a4f55'],
};

export function createKnob(param, value, onChange, small = false, style = {}) {
  const { min, max, step, unit, label } = param;
  const uid = `knob${knobSeq++}`;
  let current = clampSnap(value, min, max, step);

  // Per-pedal styling: cap gradient stops, arc accent, pointer color, shape.
  const capCols = style.cap || ['#58585f', '#2a2a2f', '#0f0f12'];
  const accent = style.accent || '#ff9f0a';
  const pointerCol = style.pointer || 'rgba(255,255,255,0.9)';
  const shape = style.shape || 'round';

  // Geometry — amp knobs 54px, pedal knobs 44px; pass a number for a custom size.
  const numeric = typeof small === 'number';
  const SZ = numeric ? small : (small ? 44 : 54), C = SZ / 2;
  const RTO = numeric ? SZ * 0.43 : (small ? 19 : 23);   // tick outer
  const RTI = numeric ? SZ * 0.36 : (small ? 16 : 19);   // tick inner
  const RTR = numeric ? SZ * 0.31 : (small ? 13.5 : 17); // track / arc radius
  const RC = numeric ? SZ * 0.205 : (small ? 9 : 12);    // cap radius

  const el = document.createElement('div');
  el.className = 'knob';
  el.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;cursor:ns-resize;user-select:none;touch-action:none;outline:none;';
  el.setAttribute('role', 'slider');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', String(min));
  el.setAttribute('aria-valuemax', String(max));

  const svg = svgEl('svg', { viewBox: `0 0 ${SZ} ${SZ}`, width: String(SZ), height: String(SZ), class: 'knob-dial' });
  svg.style.overflow = 'visible';

  const defs = svgEl('defs', {});
  const grad = svgEl('radialGradient', { id: `${uid}-c`, cx: '34%', cy: '26%', r: '72%' });
  grad.append(
    svgEl('stop', { offset: '0%', 'stop-color': capCols[0] }),
    svgEl('stop', { offset: '50%', 'stop-color': capCols[1] }),
    svgEl('stop', { offset: '100%', 'stop-color': capCols[2] }),
  );
  const hi = svgEl('radialGradient', { id: `${uid}-h`, cx: '28%', cy: '22%', r: '55%' });
  hi.append(
    svgEl('stop', { offset: '0%', 'stop-color': 'rgba(255,255,255,0.2)' }),
    svgEl('stop', { offset: '100%', 'stop-color': 'rgba(255,255,255,0)' }),
  );
  // Machined-chrome bezel ring around the cap: a top-lit vertical sheen
  // (bright crown → dark waist → light rim) reads as turned metal under the
  // one top-left light. Deep-dish GB knob look; static, costs nothing.
  const bez = svgEl('linearGradient', { id: `${uid}-b`, x1: '0', y1: '0', x2: '0', y2: '1' });
  bez.append(
    svgEl('stop', { offset: '0%', 'stop-color': '#f4f6f8' }),
    svgEl('stop', { offset: '38%', 'stop-color': '#9aa0a6' }),
    svgEl('stop', { offset: '60%', 'stop-color': '#54595f' }),
    svgEl('stop', { offset: '100%', 'stop-color': '#c8ced3' }),
  );
  const glow = svgEl('filter', { id: `${uid}-g`, x: '-100%', y: '-100%', width: '300%', height: '300%' });
  glow.append(
    svgEl('feGaussianBlur', { stdDeviation: '2', result: 'b' }),
  );
  const merge = svgEl('feMerge', {});
  merge.append(svgEl('feMergeNode', { in: 'b' }), svgEl('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  defs.append(grad, hi, glow, bez);

  const ticks = svgEl('g', { class: 'knob-ticks' });
  for (let i = 0; i <= 10; i++) {
    const ang = -135 + i * 27;
    const a = polar(C, C, RTO, ang), b = polar(C, C, RTI, ang);
    ticks.append(svgEl('line', {
      x1: a.x.toFixed(2), y1: a.y.toFixed(2), x2: b.x.toFixed(2), y2: b.y.toFixed(2),
      stroke: i === 5 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)',
      'stroke-width': '1.5', 'stroke-linecap': 'round',
    }));
  }

  const track = svgEl('path', { class: 'knob-track', d: arcPath(C, C, RTR, -135, 135), fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': '3.5', 'stroke-linecap': 'round' });
  // Arc: pedals tint inline via style.accent; amp/theme arcs stay CSS-driven
  // (main themes .knob-arc by CSS), so only set an inline stroke when given one.
  const arc = svgEl('path', { class: 'knob-arc', fill: 'none', 'stroke-width': '3.5', 'stroke-linecap': 'round', filter: `url(#${uid}-g)` });
  if (style.accent) arc.setAttribute('stroke', accent);

  // Optional engraved number ring (0..10) around the dial — amp-panel knobs.
  const nums = svgEl('g', { class: 'knob-nums' });
  if (style.numbered) {
    for (let i = 0; i <= 10; i++) {
      const ang = -135 + i * 27;
      const pt = polar(C, C, RTO + (numeric ? 3.5 : 6), ang);
      const t = svgEl('text', {
        x: pt.x.toFixed(1), y: (pt.y + (numeric ? 1.7 : 2.3)).toFixed(1), 'text-anchor': 'middle',
        'font-size': String(numeric ? 5 : 6.5), 'font-weight': '700', fill: 'rgba(255,255,255,0.8)',
      });
      t.style.fontFamily = "'Inter', sans-serif";
      t.textContent = String(i);
      nums.appendChild(t);
    }
  }

  // Machined chrome bezel ring (drawn behind the cap so its outer edge frames
  // the dish) and a crisp top-left specular glint arc over the crown.
  const ring = svgEl('circle', { class: 'knob-ring', cx: String(C), cy: String(C), r: (RC + RC * 0.24).toFixed(2), fill: 'none', stroke: `url(#${uid}-b)`, 'stroke-width': (RC * 0.34).toFixed(2) });
  const specArc = svgEl('path', { class: 'knob-specarc', d: arcPath(C, C, RC * 0.62, -74, -16), fill: 'none', stroke: 'rgba(255,255,255,0.85)', 'stroke-width': (RC * 0.11).toFixed(2), 'stroke-linecap': 'round' });

  // Cap. 'round' = circular cap + a pointer line; 'chicken' = a rotating
  // chicken-head cap whose beak is the indicator (vintage vibe).
  let capg = null, ptr = null;
  if (shape === 'chicken') {
    capg = svgEl('g', { class: 'knob-cap' });
    capg.append(
      svgEl('circle', { cx: String(C), cy: String(C), r: String(RC), fill: `url(#${uid}-c)`, stroke: 'rgba(0,0,0,0.6)', 'stroke-width': '0.75' }),
      svgEl('path', { d: `M ${C} ${(C - RC - 4).toFixed(2)} L ${(C - 3.6).toFixed(2)} ${(C - RC + 2).toFixed(2)} L ${(C + 3.6).toFixed(2)} ${(C - RC + 2).toFixed(2)} Z`, fill: pointerCol, stroke: 'rgba(0,0,0,0.4)', 'stroke-width': '0.5' }),
      svgEl('circle', { class: 'knob-spec', cx: (C - RC * 0.18).toFixed(2), cy: (C - RC * 0.24).toFixed(2), r: (RC * 0.5).toFixed(2), fill: `url(#${uid}-h)` }),
    );
    svg.append(defs, ticks, nums, track, arc, ring, capg);
  } else {
    const cap = svgEl('circle', { class: 'knob-cap', cx: String(C), cy: String(C), r: String(RC), fill: `url(#${uid}-c)`, stroke: 'rgba(0,0,0,0.6)', 'stroke-width': '0.75' });
    const spec = svgEl('circle', { class: 'knob-spec', cx: (C - RC * 0.15).toFixed(2), cy: (C - RC * 0.22).toFixed(2), r: (RC * 0.52).toFixed(2), fill: `url(#${uid}-h)` });
    ptr = svgEl('line', { class: 'knob-pointer', stroke: pointerCol, 'stroke-width': '2', 'stroke-linecap': 'round' });
    svg.append(defs, ticks, nums, track, arc, ring, cap, spec, specArc, ptr);
  }

  const valEl = document.createElement('span'); valEl.className = 'val';
  valEl.style.cssText = `font-size:${small ? 9 : 10}px;font-weight:600;color:#c8c8cc;font-family:'JetBrains Mono','SF Mono',ui-monospace,monospace;`;
  const labelEl = document.createElement('span'); labelEl.className = 'label'; labelEl.textContent = label;
  labelEl.style.cssText = `font-size:${small ? 8 : 9}px;color:#48484e;text-transform:uppercase;letter-spacing:.06em;text-align:center;`;
  el.append(svg, valEl, labelEl);

  // Tooltip showing the knob's name, surfaced only while the user is tuning it
  // (drag / wheel / keyboard / hover). A single body-level element is used so it
  // is never clipped by the pedal's rounded overflow, even at the board edges.
  let hideT = null;
  const sharedTip = () => {
    let t = document.getElementById('knob-tip');
    if (!t) { t = document.createElement('div'); t.id = 'knob-tip'; t.className = 'knob-tip'; document.body.appendChild(t); }
    return t;
  };
  const showTip = () => {
    if (hideT) { clearTimeout(hideT); hideT = null; }
    const t = sharedTip();
    t.textContent = label; t._owner = el;
    const r = el.getBoundingClientRect();
    t.style.left = `${r.left + r.width / 2}px`;
    t.style.top = `${r.top}px`;
    t.classList.add('on');
  };
  const hideTip = () => {
    if (hideT) { clearTimeout(hideT); hideT = null; }
    const t = document.getElementById('knob-tip');
    if (t && t._owner === el) t.classList.remove('on');
  };
  const tipFade = (ms = 750) => { if (hideT) clearTimeout(hideT); hideT = setTimeout(hideTip, ms); };

  function paint() {
    const ang = valueToAngle(current, min, max);
    const t = max === min ? 0 : (current - min) / (max - min);
    arc.setAttribute('d', t > 0 ? arcPath(C, C, RTR, -135, ang) : 'M0 0');
    if (capg) {
      capg.setAttribute('transform', `rotate(${ang.toFixed(1)} ${C} ${C})`);
    } else {
      const p1 = polar(C, C, RC - 3.5, ang), p2 = polar(C, C, RC, ang);
      ptr.setAttribute('x1', p1.x.toFixed(2)); ptr.setAttribute('y1', p1.y.toFixed(2));
      ptr.setAttribute('x2', p2.x.toFixed(2)); ptr.setAttribute('y2', p2.y.toFixed(2));
    }
    const text = format(current, step, unit);
    valEl.textContent = text;
    el.setAttribute('aria-valuenow', String(current));
    el.setAttribute('aria-valuetext', text);
  }
  function setValue(v) { current = clampSnap(v, min, max, step); paint(); }
  function change(v) { const nv = clampSnap(v, min, max, step); current = nv; paint(); onChange(nv); }

  el.addEventListener('keydown', (e) => {
    let handled = true;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') change(current + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') change(current - step);
    else if (e.key === 'PageUp') change(current + step * 10);
    else if (e.key === 'PageDown') change(current - step * 10);
    else if (e.key === 'Home') change(min);
    else if (e.key === 'End') change(max);
    else handled = false;
    if (handled) { e.preventDefault(); showTip(); tipFade(); }
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); change(current + (e.deltaY < 0 ? step : -step)); showTip(); tipFade(900); }, { passive: false });
  el.addEventListener('dblclick', () => { change(param.default); showTip(); tipFade(); });
  el.addEventListener('focus', showTip);
  el.addEventListener('blur', hideTip);
  el.addEventListener('pointerenter', showTip);
  el.addEventListener('pointerleave', () => { if (!el.classList.contains('dragging')) hideTip(); });
  let dragStartY = 0, dragStartVal = 0;
  el.addEventListener('pointerdown', (e) => {
    dragStartY = e.clientY; dragStartVal = current; el.classList.add('dragging'); showTip();
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.classList.contains('dragging')) return;
    change(dragStartVal + ((dragStartY - e.clientY) / 140) * (max - min));
  });
  const endDrag = () => { el.classList.remove('dragging'); tipFade(500); };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  paint();
  return { el, setValue };
}
