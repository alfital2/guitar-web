// tests/clip-clipboard.test.js
// Clipboard paste/duplicate placement (planPaste) and the select-all selection
// setter that back the ⌘/Ctrl C/X/V/D/A clip shortcuts.
import { describe, it, expect } from 'vitest';
import { planPaste, resolveNoOverlap } from '../src/clip-ops.js';
import { setClipSelection, getSelectedClips, clearClipSelection } from '../src/track-lane.js';

// Test takes carry their width directly; main.js passes its clipWidth instead.
const widthOf = (t) => t.w;
const clip = (trackId, dx, w, name) => ({ trackId, dx, take: { w, name } });
const occ = (byTrack = {}) => new Map(Object.entries(byTrack).map(([id, slots]) => [+id, slots]));
const overlap = (a, b) => a.x < b.x + widthOf(b.take) && a.x + widthOf(a.take) > b.x;

describe('planPaste', () => {
  it('lands a single clip exactly at targetX on an empty track', () => {
    const [p] = planPaste([clip(1, 0, 64)], 320, occ(), widthOf);
    expect(p).toMatchObject({ trackId: 1, x: 320 });
  });

  it('preserves the relative arrangement across tracks (leftmost at targetX)', () => {
    const placed = planPaste([clip(1, 0, 64, 'a'), clip(2, 100, 48, 'b')], 320, occ(), widthOf);
    const a = placed.find((p) => p.take.name === 'a');
    const b = placed.find((p) => p.take.name === 'b');
    expect(a.x).toBe(320);
    expect(b.x).toBe(420); // 320 + dx 100
    expect(b.x - a.x).toBe(100);
  });

  it('preserves same-track gaps between pasted clips', () => {
    const placed = planPaste([clip(1, 0, 64, 'a'), clip(1, 100, 64, 'b')], 320, occ(), widthOf);
    expect(placed.map((p) => p.x)).toEqual([320, 420]);
  });

  it('places leftmost-first regardless of input order', () => {
    const placed = planPaste([clip(1, 100, 64, 'right'), clip(1, 0, 64, 'left')], 0, occ(), widthOf);
    expect(placed[0].take.name).toBe('left');
    expect(placed.find((p) => p.take.name === 'left').x).toBe(0);
    expect(placed.find((p) => p.take.name === 'right').x).toBe(100);
  });

  it('resolves collisions with existing clips via resolveNoOverlap', () => {
    const existing = [{ x: 300, w: 100 }];
    const [p] = planPaste([clip(1, 0, 64)], 320, occ({ 1: existing }), widthOf);
    expect(p.x).toBe(Math.round(resolveNoOverlap(existing, 320, 64)));
    expect(overlap(p, { x: 300, take: { w: 100 } })).toBe(false);
  });

  it('pasted clips never overlap each other (same desired slot)', () => {
    const placed = planPaste([clip(1, 0, 64, 'a'), clip(1, 0, 64, 'b')], 320, occ(), widthOf);
    expect(overlap(placed[0], placed[1])).toBe(false);
    expect(placed.some((p) => p.x === 320)).toBe(true); // one of them still lands at the target
  });

  it('never places left of 0', () => {
    const placed = planPaste([clip(1, 0, 64)], 0, occ({ 1: [{ x: 0, w: 64 }] }), widthOf);
    expect(placed[0].x).toBeGreaterThanOrEqual(0);
    expect(overlap(placed[0], { x: 0, take: { w: 64 } })).toBe(false);
  });

  it('returns integer positions for fractional inputs', () => {
    const [p] = planPaste([clip(1, 10.4, 64)], 100.3, occ(), widthOf);
    expect(Number.isInteger(p.x)).toBe(true);
  });

  it('duplicate pattern: dx = x + width places the copy right after the original', () => {
    // Original at x=50, w=64 → duplicateClips passes dx = 114 with targetX = 0.
    const [p] = planPaste([clip(1, 50 + 64, 64)], 0, occ({ 1: [{ x: 50, w: 64 }] }), widthOf);
    expect(p.x).toBe(114);
  });

  it('duplicate pattern: a neighbor occupying the slot pushes the copy to a free one', () => {
    const existing = [{ x: 50, w: 64 }, { x: 114, w: 50 }]; // original + neighbor right after it
    const [p] = planPaste([clip(1, 114, 64)], 0, occ({ 1: existing }), widthOf);
    expect(p.x).toBe(Math.round(resolveNoOverlap(existing, 114, 64)));
    for (const o of existing) expect(overlap(p, { x: o.x, take: { w: o.w } })).toBe(false);
  });

  it('does not mutate the caller occupancy or clip list', () => {
    const existing = [{ x: 0, w: 64 }];
    const clips = [clip(1, 0, 64, 'a'), clip(1, 100, 64, 'b')];
    planPaste(clips, 320, occ({ 1: existing }), widthOf);
    expect(existing).toEqual([{ x: 0, w: 64 }]);
    expect(clips.map((c) => c.take.name)).toEqual(['a', 'b']); // order untouched
  });
});

describe('setClipSelection (select all / select pasted)', () => {
  const makeClips = (root, pairs) => {
    for (const [t, n] of pairs) {
      const c = document.createElement('div');
      c.className = 'track-clip';
      c.dataset.trackId = String(t);
      c.dataset.takeId = String(n);
      root.appendChild(c);
    }
  };

  it('replaces the selection and applies the highlight to the container', () => {
    const root = document.createElement('div');
    makeClips(root, [[1, 1], [1, 2], [2, 3]]);
    clearClipSelection();
    setClipSelection([{ trackId: 1, n: 1 }, { trackId: 2, n: 3 }], root);
    expect(getSelectedClips().sort((a, b) => a.n - b.n)).toEqual([{ trackId: 1, n: 1 }, { trackId: 2, n: 3 }]);
    const marked = [...root.querySelectorAll('.track-clip.selected')].map((c) => `${c.dataset.trackId}:${c.dataset.takeId}`);
    expect(marked).toEqual(['1:1', '2:3']);
    clearClipSelection();
  });

  it('drops any previous selection (replace, not add)', () => {
    const root = document.createElement('div');
    makeClips(root, [[1, 1], [1, 2]]);
    clearClipSelection();
    setClipSelection([{ trackId: 1, n: 1 }], root);
    setClipSelection([{ trackId: 1, n: 2 }], root);
    expect(getSelectedClips()).toEqual([{ trackId: 1, n: 2 }]);
    expect(root.querySelectorAll('.track-clip.selected')).toHaveLength(1);
    clearClipSelection();
  });

  it('works without a container (highlight deferred to the next render)', () => {
    clearClipSelection();
    setClipSelection([{ trackId: 3, n: 7 }]);
    expect(getSelectedClips()).toEqual([{ trackId: 3, n: 7 }]);
    clearClipSelection();
  });
});
