// src/chain-ui/power-on.js
// One-shot "power-on ritual": on a successful engine start the amp warms up
// (a brief intensity ramp on the existing tube / value-strip glow) and then the
// chain lights up in signal order (each connector — or, when the board is
// folded, each mini — pulses left→right), before everything settles back to
// normal. ≤2s total, transform/opacity only, runs exactly once per power-on,
// and is skipped entirely under prefers-reduced-motion (no infinite loops).
//
// Mechanism is CSS-driven: this adds classes (and per-node stagger delays via a
// CSS custom property) and removes them once after a fixed budget, so it is
// deterministic and unit-testable with fake timers. It is only ever invoked
// from start() — never from a chain rebuild/re-render — so it can't re-trigger.

const WARM_MS = 1000;      // tube / strip warm-up duration
const LIT_START_S = 0.45;  // first connector lights after the warm-up begins
const LIT_STEP_S = 0.14;   // stagger between successive connectors
const LIT_ANIM_MS = 500;   // each connector's pulse duration
const BUDGET_MS = 2000;    // hard cap for the whole ritual (contract: ≤2s)

// One ritual at a time: while a ritual is in flight, further calls are no-ops,
// so a DOM rebuild / double power event can never re-trigger or double-apply.
let active = false;

export function prefersReducedMotion(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  try {
    return !!(w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

// Play the ritual. Options:
//   document / window — injectable environment (defaults to globals)
//   force            — run even under reduced-motion (tests only)
//   setTimeout       — injectable timer (tests only)
// Returns { ran, warmed, lit } describing what it touched.
export function playPowerOnRitual(opts = {}) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null);
  const win = opts.window || (typeof window !== 'undefined' ? window : null);
  const timer = opts.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
  if (!doc) return { ran: false, warmed: false, lit: 0 };
  if (!opts.force && prefersReducedMotion(win)) return { ran: false, warmed: false, lit: 0 };
  if (active) return { ran: false, warmed: false, lit: 0 }; // one-shot: already in flight

  const amp = doc.getElementById('amp');
  const chain = doc.getElementById('chain');

  // 1) Amp warm-up — the class drives both the expanded tubes and the collapsed
  //    value strip (whichever is visible) via CSS.
  let warmed = false;
  if (amp) { amp.classList.add('power-warmup'); warmed = true; }

  // 2) Chain lights up in signal order. The expanded board's connectors, or —
  //    when the board is folded (the connectors exist but are display:none) —
  //    the mini strip pedals + AMP chip.
  let nodes = [];
  if (chain) {
    const folded = !!chain.querySelector('.board-wrap.collapsed');
    nodes = folded ? [] : [...chain.querySelectorAll('.connector')];
    if (!nodes.length) nodes = [...chain.querySelectorAll('.board-strip-mini, .board-strip-amp')];
  }
  // Stagger, compressed if needed so the LAST pulse still ends inside the ≤2s
  // budget however long the chain is.
  const maxSpan = (BUDGET_MS - LIT_ANIM_MS) / 1000 - LIT_START_S; // seconds available for staggering
  const step = nodes.length > 1 ? Math.min(LIT_STEP_S, maxSpan / (nodes.length - 1)) : 0;
  nodes.forEach((n, i) => {
    n.style.setProperty('--lit-delay', (LIT_START_S + i * step).toFixed(2) + 's');
    n.classList.add('power-lit');
  });

  // 3) Settle: remove every class once, after the whole sequence has run. Fixed
  //    budget (deterministic; never an infinite loop).
  const lastLitMs = nodes.length
    ? LIT_START_S * 1000 + (nodes.length - 1) * step * 1000 + LIT_ANIM_MS
    : 0;
  const totalMs = Math.min(Math.max(WARM_MS, lastLitMs), BUDGET_MS);
  const cleanup = () => {
    active = false;
    if (amp) amp.classList.remove('power-warmup');
    for (const n of nodes) { n.classList.remove('power-lit'); n.style.removeProperty('--lit-delay'); }
  };
  active = true;
  if (timer) timer(cleanup, totalMs);
  else cleanup();

  return { ran: true, warmed, lit: nodes.length, totalMs };
}
