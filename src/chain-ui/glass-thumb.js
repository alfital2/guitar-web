// src/chain-ui/glass-thumb.js
// Overlay a real refracting "liquid glass" thumb on a native range slider.
//
// Native ::-webkit-slider-thumb cannot host backdrop-filter, so a translucent
// thumb only ALPHA-BLENDS the track through it — no refraction. The fix
// (kube.io technique): keep the native <input> for all value/drag/keyboard/a11y
// but hide its thumb pixels, and float a real <div> that carries
// `backdrop-filter: url(#glass-thumb)` so the <feDisplacementMap> actually bends
// the accent-filled track behind it.
//
// Perf: the SVG backdrop-filter re-runs every frame the element moves, which is
// what spun the fans. So during an active drag we drop to a cheap static thumb
// (no filter) and only pay for the lens while the thumb is at rest. The thumb is
// moved with transform (compositor-only) and repaints are rAF-coalesced.

export function attachGlassThumb(input, { width = 40, height = 30 } = {}) {
  if (!input || input.dataset.glass) return () => {};
  input.dataset.glass = '1';
  input.classList.add('has-glass');

  const wrap = document.createElement('span');
  wrap.className = 'slider-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const thumb = document.createElement('span');
  thumb.className = 'glass-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  thumb.style.width = `${width}px`;
  thumb.style.height = `${height}px`;
  wrap.appendChild(thumb);

  const lo = () => parseFloat(input.min || '0');
  const hi = () => { const m = parseFloat(input.max || '1'); return m === lo() ? lo() + 1 : m; };

  let raf = 0;
  function place() {
    raf = 0;
    const trackW = input.clientWidth;
    const frac = Math.max(0, Math.min(1, (parseFloat(input.value) - lo()) / (hi() - lo())));
    // Match Chrome's thumb clamping: centre travels [w/2 .. trackW - w/2].
    const centerX = width / 2 + frac * (trackW - width);
    thumb.style.transform = `translate(${(centerX - width / 2).toFixed(2)}px, -50%)`;
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };

  input.addEventListener('input', schedule);

  // Active-drag downgrade: no per-frame SVG filter while the thumb is moving.
  const setDrag = (on) => wrap.classList.toggle('dragging', on);
  input.addEventListener('pointerdown', () => setDrag(true));
  window.addEventListener('pointerup', () => setDrag(false));
  let kt = 0;
  input.addEventListener('keydown', () => { setDrag(true); clearTimeout(kt); kt = setTimeout(() => setDrag(false), 250); });

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(schedule).observe(input);
  place();
  return place; // call after programmatic value changes
}
