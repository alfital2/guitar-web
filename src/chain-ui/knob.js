// src/chain-ui/knob.js
const NS = 'http://www.w3.org/2000/svg';

export function valueToAngle(value, min, max, startDeg = -135, endDeg = 135) {
  const t = max === min ? 0 : (value - min) / (max - min);
  const c = Math.max(0, Math.min(1, t));
  return startDeg + c * (endDeg - startDeg);
}

function clampSnap(v, min, max, step) {
  const snapped = Math.round((v - min) / step) * step + min;
  const fixed = Math.round(snapped * 1e6) / 1e6; // kill float dust
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

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = polar(cx, cy, r, endDeg), e = polar(cx, cy, r, startDeg);
  const large = Math.abs(endDeg - startDeg) <= 180 ? 0 : 1;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 0 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export function createKnob(param, value, onChange) {
  const { min, max, step, unit, label } = param;
  let current = clampSnap(value, min, max, step);

  const el = document.createElement('div');
  el.className = 'knob';
  el.setAttribute('role', 'slider');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', String(min));
  el.setAttribute('aria-valuemax', String(max));

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 56'); svg.setAttribute('class', 'knob-dial');
  const track = document.createElementNS(NS, 'path');
  track.setAttribute('class', 'knob-track'); track.setAttribute('d', arcPath(28, 28, 20, -135, 135));
  const arc = document.createElementNS(NS, 'path'); arc.setAttribute('class', 'knob-arc');
  const ptr = document.createElementNS(NS, 'line');
  ptr.setAttribute('class', 'knob-pointer'); ptr.setAttribute('x1', '28'); ptr.setAttribute('y1', '28');
  svg.append(track, arc, ptr);

  const valEl = document.createElement('span'); valEl.className = 'val';
  const labelEl = document.createElement('span'); labelEl.className = 'label'; labelEl.textContent = label;
  el.append(svg, valEl, labelEl);

  function paint() {
    const ang = valueToAngle(current, min, max);
    arc.setAttribute('d', arcPath(28, 28, 20, -135, ang));
    const p = polar(28, 28, 15, ang);
    ptr.setAttribute('x2', p.x.toFixed(2)); ptr.setAttribute('y2', p.y.toFixed(2));
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
    if (handled) e.preventDefault();
  });
  el.addEventListener('wheel', (e) => { e.preventDefault(); change(current + (e.deltaY < 0 ? step : -step)); }, { passive: false });
  el.addEventListener('dblclick', () => change(param.default));

  let dragStartY = 0, dragStartVal = 0;
  el.addEventListener('pointerdown', (e) => {
    dragStartY = e.clientY; dragStartVal = current; el.classList.add('dragging');
    try { el.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.classList.contains('dragging')) return;
    const dy = dragStartY - e.clientY;
    change(dragStartVal + (dy / 150) * (max - min));
  });
  const endDrag = () => el.classList.remove('dragging');
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  paint();
  return { el, setValue };
}
