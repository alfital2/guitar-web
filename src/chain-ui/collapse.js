// src/chain-ui/collapse.js — one Apple-flavoured collapse/expand transition,
// shared by the amp head↔strip and the pedalboard↔strip folds.
//
// The panel swaps between a tall "editing" body and a slim "value strip". CSS
// keeps whichever is active in normal flow and lifts the other to an absolute,
// opacity:0 overlay (see the `.collapsed` rules), so exactly one sets the
// wrap's height at rest. To animate, we measure the wrap height before and
// after the class flip and tween it with a spring-settle curve while
// cross-fading the two bodies — GPU-cheap (height on one element, opacity +
// a small translate on two), one-shot, and reduced-motion aware.

// Fast, slightly overshoot-free "settle" — the iOS sheet feel.
const EASE = 'cubic-bezier(.32, .72, 0, 1)';
const DUR = 340;

function prefersReduced() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// wrap:      the .amp-wrap / .board-wrap whose height we tween
// toggle():  flips the `.collapsed` class (+ inert), called between the two
//            height measurements so we capture the real before/after sizes
// outgoing:  body being hidden (fades out)
// incoming:  body being revealed (fades + slides in)
// toCollapsed: direction (only affects the slide sign)
export function animateCollapse(wrap, { toggle, outgoing, incoming, toCollapsed }) {
  if (prefersReduced() || typeof wrap.animate !== 'function') { toggle(); return; }

  const startH = wrap.getBoundingClientRect().height;
  toggle();
  const endH = wrap.getBoundingClientRect().height;
  if (Math.abs(startH - endH) < 1) return; // nothing to tween

  wrap.style.overflow = 'hidden';
  wrap.style.willChange = 'height';
  const hAnim = wrap.animate(
    [{ height: `${startH}px` }, { height: `${endH}px` }],
    { duration: DUR, easing: EASE },
  );

  if (outgoing) {
    outgoing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DUR * 0.42, easing: 'ease-out' });
  }
  if (incoming) {
    const dy = toCollapsed ? -8 : 12;
    incoming.animate(
      [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: 'none' }],
      { duration: DUR, easing: EASE },
    );
  }

  const cleanup = () => { wrap.style.overflow = ''; wrap.style.willChange = ''; };
  hAnim.onfinish = cleanup;
  hAnim.oncancel = cleanup;
}
