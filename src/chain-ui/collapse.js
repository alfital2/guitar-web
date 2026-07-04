// src/chain-ui/collapse.js — one Apple-flavoured collapse/expand transition,
// shared by the amp head↔strip and the pedalboard↔strip folds.
//
// The panel swaps between a tall "editing" body and a slim "value strip". At
// REST the inactive body is plain `display:none` (no layout, no overflow). To
// animate we tween the wrap's height between the two measured sizes with a
// spring-settle curve, and cross-fade the bodies. The subtlety: the outgoing
// body must keep its EXACT rendered size/position while it fades — so we pin it
// to a captured box as an absolute overlay (same width, left, display) instead
// of letting `display:none → absolute` reflow it (which made the amp head go
// narrow and drift). GPU-cheap (height on one node, opacity on two), one-shot,
// reduced-motion aware.

const EASE = 'cubic-bezier(.32, .72, 0, 1)'; // fast, no-overshoot iOS settle
const DUR = 340;

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// wrap:        the .amp-wrap / .board-wrap whose height we tween (position:relative)
// toggle():    flips the `.collapsed` class (+ inert), between the two measurements
// outgoing:    body being hidden — pinned to its captured box, fades out
// incoming:    body being revealed — sets the target height, fades in
export function animateCollapse(wrap, { toggle, outgoing, incoming }) {
  if (prefersReduced() || typeof wrap.animate !== 'function') { toggle(); return; }

  const startH = wrap.getBoundingClientRect().height;
  // Capture the outgoing body's rendered box + display BEFORE it's hidden, so
  // the overlay we re-show is pixel-identical (no reflow, no resize).
  const wr = wrap.getBoundingClientRect();
  const or_ = outgoing.getBoundingClientRect();
  const box = { left: or_.left - wr.left, top: or_.top - wr.top, width: or_.width, display: getComputedStyle(outgoing).display };

  toggle();
  const endH = wrap.getBoundingClientRect().height;
  if (Math.abs(startH - endH) < 1) return; // nothing to tween

  wrap.style.overflow = 'hidden';
  wrap.style.willChange = 'height';

  // Re-show the (now display:none) outgoing body as a same-size overlay so it
  // can fade in place while the wrap collapses around/over it.
  const prevStyle = outgoing.style.cssText;
  outgoing.style.display = box.display;
  outgoing.style.position = 'absolute';
  outgoing.style.left = `${box.left}px`;
  outgoing.style.top = `${box.top}px`;
  outgoing.style.width = `${box.width}px`;
  outgoing.style.margin = '0';
  outgoing.style.pointerEvents = 'none';
  outgoing.style.zIndex = '1';

  const hAnim = wrap.animate([{ height: `${startH}px` }, { height: `${endH}px` }], { duration: DUR, easing: EASE });
  outgoing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.round(DUR * 0.6), easing: 'ease-out' });
  incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR, easing: EASE });

  const cleanup = () => {
    wrap.style.overflow = ''; wrap.style.willChange = '';
    outgoing.style.cssText = prevStyle; // restore → back to CSS display:none
  };
  hAnim.onfinish = cleanup;
  hAnim.oncancel = cleanup;
}
