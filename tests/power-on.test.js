// tests/power-on.test.js — the one-shot power-on ritual: warm-up + connectors
// lighting left→right, ≤2s budget, single-flight (rebuilds can't re-trigger),
// clean settle, and the prefers-reduced-motion skip.
import { describe, it, expect, afterEach } from 'vitest';
import { playPowerOnRitual, prefersReducedMotion } from '../src/chain-ui/power-on.js';

// Build the minimal app DOM the ritual touches: #amp and #chain with a board
// wrap holding connectors (expanded) and strip minis (fallback when folded).
function buildDom({ connectors = 3, minis = 2, folded = false } = {}) {
  document.body.innerHTML = '';
  const amp = document.createElement('div'); amp.id = 'amp';
  const chain = document.createElement('div'); chain.id = 'chain';
  const wrap = document.createElement('div');
  wrap.className = 'board-wrap' + (folded ? ' collapsed' : '');
  for (let i = 0; i < connectors; i++) {
    const c = document.createElement('div'); c.className = 'connector'; wrap.appendChild(c);
  }
  const strip = document.createElement('div'); strip.className = 'board-strip';
  const ampChip = document.createElement('div'); ampChip.className = 'board-strip-amp'; strip.appendChild(ampChip);
  for (let i = 0; i < minis; i++) {
    const m = document.createElement('div'); m.className = 'board-strip-mini'; strip.appendChild(m);
  }
  wrap.appendChild(strip);
  chain.appendChild(wrap);
  document.body.append(amp, chain);
  return { amp, chain, wrap };
}

// Manual timer so tests control the settle deterministically.
function fakeTimer() {
  const jobs = [];
  const t = (fn, ms) => { jobs.push({ fn, ms }); };
  t.flush = () => { for (const j of jobs.splice(0)) j.fn(); };
  t.delays = () => jobs.map((j) => j.ms);
  return t;
}

const noMotion = { matchMedia: () => ({ matches: true }) };
const motionOk = { matchMedia: () => ({ matches: false }) };

afterEach(() => { document.body.innerHTML = ''; });

describe('playPowerOnRitual', () => {
  it('warms the amp and lights every connector left→right with growing delays', () => {
    const { amp, chain } = buildDom({ connectors: 4 });
    const timer = fakeTimer();
    const res = playPowerOnRitual({ document, window: motionOk, setTimeout: timer });
    expect(res.ran).toBe(true);
    expect(res.warmed).toBe(true);
    expect(res.lit).toBe(4);
    expect(amp.classList.contains('power-warmup')).toBe(true);
    const lit = [...chain.querySelectorAll('.power-lit')];
    expect(lit).toHaveLength(4);
    expect(lit.every((n) => n.classList.contains('connector'))).toBe(true);
    const delays = lit.map((n) => parseFloat(n.style.getPropertyValue('--lit-delay')));
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    timer.flush();
  });

  it('settles: one cleanup removes every class and stagger delay', () => {
    const { amp, chain } = buildDom({ connectors: 3 });
    const timer = fakeTimer();
    playPowerOnRitual({ document, window: motionOk, setTimeout: timer });
    timer.flush();
    expect(amp.classList.contains('power-warmup')).toBe(false);
    expect(chain.querySelectorAll('.power-lit')).toHaveLength(0);
    expect([...chain.querySelectorAll('.connector')]
      .every((n) => n.style.getPropertyValue('--lit-delay') === '')).toBe(true);
  });

  it('stays within the 2s budget even with a very long chain', () => {
    buildDom({ connectors: 30 });
    const timer = fakeTimer();
    const res = playPowerOnRitual({ document, window: motionOk, setTimeout: timer });
    expect(res.lit).toBe(30);
    expect(res.totalMs).toBeLessThanOrEqual(2000);
    expect(Math.max(...timer.delays())).toBeLessThanOrEqual(2000);
    timer.flush();
  });

  it('is one-shot: a second call while in flight (e.g. a rebuild) is a no-op', () => {
    buildDom();
    const timer = fakeTimer();
    expect(playPowerOnRitual({ document, window: motionOk, setTimeout: timer }).ran).toBe(true);
    // re-invocation before the settle — must NOT re-trigger
    expect(playPowerOnRitual({ document, window: motionOk, setTimeout: timer }).ran).toBe(false);
    timer.flush(); // ritual settles…
    // …and only a NEW power-on may run it again
    expect(playPowerOnRitual({ document, window: motionOk, setTimeout: timer }).ran).toBe(true);
    timer.flush();
  });

  it('lights the strip minis + AMP chip instead when the board is folded', () => {
    const { chain } = buildDom({ connectors: 3, minis: 2, folded: true });
    const timer = fakeTimer();
    const res = playPowerOnRitual({ document, window: motionOk, setTimeout: timer });
    expect(res.lit).toBe(3); // AMP chip + 2 minis
    const lit = [...chain.querySelectorAll('.power-lit')];
    expect(lit.some((n) => n.classList.contains('connector'))).toBe(false);
    expect(lit.some((n) => n.classList.contains('board-strip-amp'))).toBe(true);
    timer.flush();
  });

  it('is skipped entirely under prefers-reduced-motion', () => {
    const { amp, chain } = buildDom();
    const timer = fakeTimer();
    const res = playPowerOnRitual({ document, window: noMotion, setTimeout: timer });
    expect(res).toEqual({ ran: false, warmed: false, lit: 0 });
    expect(amp.classList.contains('power-warmup')).toBe(false);
    expect(chain.querySelectorAll('.power-lit')).toHaveLength(0);
    expect(timer.delays()).toHaveLength(0);
  });

  it('force:true overrides reduced-motion (test hook)', () => {
    buildDom();
    const timer = fakeTimer();
    const res = playPowerOnRitual({ document, window: noMotion, setTimeout: timer, force: true });
    expect(res.ran).toBe(true);
    timer.flush();
  });
});

describe('prefersReducedMotion', () => {
  it('reads the media query and defaults to false without matchMedia', () => {
    expect(prefersReducedMotion(noMotion)).toBe(true);
    expect(prefersReducedMotion(motionOk)).toBe(false);
    expect(prefersReducedMotion({})).toBe(false);
    expect(prefersReducedMotion(null)).toBe(false);
  });
});
