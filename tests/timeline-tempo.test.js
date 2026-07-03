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

// ── zoom persistence + steps ──
import { ZOOM_STEPS } from '../src/track-lane.js';
import { saveZoom, loadZoom } from '../src/chain-store.js';

describe('timeline zoom', () => {
  it('ZOOM_STEPS are ascending and include 1 (the default)', () => {
    expect(ZOOM_STEPS).toContain(1);
    for (let i = 1; i < ZOOM_STEPS.length; i++) expect(ZOOM_STEPS[i]).toBeGreaterThan(ZOOM_STEPS[i - 1]);
  });
  it('persists and clamps zoom to [0.5, 4]', () => {
    saveZoom(2); expect(loadZoom()).toBe(2);
    saveZoom(99); expect(loadZoom()).toBe(4);
    saveZoom(0.01); expect(loadZoom()).toBe(0.5);
    localStorage.removeItem('gs-timeline-zoom');
    expect(loadZoom()).toBe(1);
  });
});
