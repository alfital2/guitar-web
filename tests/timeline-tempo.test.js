import { describe, it, expect } from 'vitest';
import { barPx, beatPx, PX_PER_SEC, BEATS_PER_BAR } from '../src/track-lane.js';

describe('tempo-aware timeline grid', () => {
  it('120 BPM 4/4 → 64px bar / 16px beat (unchanged legacy default)', () => {
    expect(beatPx(120)).toBeCloseTo(16, 6);
    expect(barPx(120)).toBeCloseTo(64, 6);
  });
  it('80 BPM → 96px bar / 24px beat (the bug: was stuck at 64/16)', () => {
    expect(beatPx(80)).toBeCloseTo(24, 6);   // 60/80 * 32
    expect(barPx(80)).toBeCloseTo(96, 6);    // 4 beats * 24
  });
  it('bar = BEATS_PER_BAR beats at any tempo', () => {
    for (const bpm of [40, 90, 137, 240]) expect(barPx(bpm)).toBeCloseTo(BEATS_PER_BAR * beatPx(bpm), 6);
  });
  it('bar px = seconds-per-bar × PX_PER_SEC (playhead lands on bar lines)', () => {
    const bpm = 80, secPerBar = BEATS_PER_BAR * 60 / bpm; // 3s
    expect(barPx(bpm)).toBeCloseTo(secPerBar * PX_PER_SEC, 6); // 3 * 32 = 96
  });
  it('guards bpm=0/undefined → 120 default', () => {
    expect(barPx(0)).toBeCloseTo(64, 6);
    expect(barPx(undefined)).toBeCloseTo(64, 6);
  });
});

// ── zoom persistence ──
import { saveZoom, loadZoom } from '../src/chain-store.js';

describe('timeline zoom', () => {
  it('persists and clamps zoom to [0.5, 4]', () => {
    saveZoom(2); expect(loadZoom()).toBe(2);
    saveZoom(99); expect(loadZoom()).toBe(4);
    saveZoom(0.01); expect(loadZoom()).toBe(0.5);
    localStorage.removeItem('gs-timeline-zoom');
    expect(loadZoom()).toBe(1);
  });
});

// ── endless timeline: live ruler extension ──
import { ensureRulerBars } from '../src/track-lane.js';

describe('ensureRulerBars (endless timeline)', () => {
  function laneWith(bars, bw = 64) {
    const c = document.createElement('div');
    const r = document.createElement('div'); r.className = 'track-ruler';
    for (let i = 1; i <= bars; i++) { const b = document.createElement('div'); b.className = 'track-bar'; b.style.width = `${bw}px`; r.appendChild(b); }
    c.appendChild(r);
    return c;
  }
  it('appends bars to cover the playhead + 2 headroom', () => {
    const lane = laneWith(16);
    // 120 BPM → 2 s/bar; playhead at 40 s → needs ceil(40/2)+2 = 22 bars
    const n = ensureRulerBars(lane, 40, 120, 1);
    expect(n).toBe(22);
    expect(lane.querySelectorAll('.track-bar')).toHaveLength(22);
    expect(lane.querySelectorAll('.track-bar')[21].textContent).toBe('22');
  });
  it('new bars carry tempo- and zoom-scaled widths', () => {
    const lane = laneWith(16);
    ensureRulerBars(lane, 60, 80, 2); // 80 BPM bar = 96 base px, ×2 zoom = 192; 60s → 22 bars
    const cells = lane.querySelectorAll('.track-bar');
    expect(cells[cells.length - 1].style.width).toBe('192px');
  });
  it('no-op when the grid already covers the time', () => {
    const lane = laneWith(16);
    expect(ensureRulerBars(lane, 10, 120, 1)).toBe(16);
    expect(lane.querySelectorAll('.track-bar')).toHaveLength(16);
  });
});
