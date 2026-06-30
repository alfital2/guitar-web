// tests/track-lane.test.js
import { describe, it, expect } from 'vitest';
import { renderTrackLane, PX_PER_SEC, getSelectedClips, clearClipSelection } from '../src/track-lane.js';

function tracks() {
  return [
    { id: 1, name: 'Echo Studio', armed: true, takes: [{ n: 1, name: 'Echo Studio', x: 10, duration: 2, samples: new Float32Array(4) }] },
    { id: 2, name: 'Crunch', armed: false, takes: [] },
  ];
}

describe('renderTrackLane (multi-track)', () => {
  it('renders one header and one strip per track', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    expect(el.querySelectorAll('.track-header')).toHaveLength(2);
    expect(el.querySelectorAll('.track-strip')).toHaveLength(2);
    expect(el.querySelector('.track-header .track-name').textContent).toBe('Echo Studio');
  });
  it('has one shared ruler and one playhead regardless of track count', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    expect(el.querySelectorAll('.track-ruler')).toHaveLength(1);
    expect(el.querySelectorAll('.track-playhead')).toHaveLength(1);
    expect(el.querySelector('.track-playhead .playhead-grip')).toBeTruthy();
  });
  it('add-track control calls onAddTrack', () => {
    const el = document.createElement('div');
    let added = 0;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onAddTrack: () => { added++; } });
    el.querySelector('.track-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(added).toBe(1);
  });
  it('armed track header has .armed (bright box, no arm button)', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 2 });
    const headers = el.querySelectorAll('.track-header');
    expect(headers[1].classList.contains('armed')).toBe(true);
    expect(headers[0].classList.contains('armed')).toBe(false);
    expect(headers[1].querySelector('.track-rec')).toBeNull(); // arm button removed
  });
  it('clicking a track header body calls onArm(id)', () => {
    const el = document.createElement('div');
    const armed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onArm: (id) => armed.push(id) });
    el.querySelectorAll('.track-header')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(armed).toEqual([2]);
  });
  it('clicking the track name enters rename, Enter commits onRename', () => {
    const el = document.createElement('div');
    const renamed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onRename: (id, name) => renamed.push([id, name]) });
    el.querySelectorAll('.track-header')[1].querySelector('.track-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const inp = el.querySelectorAll('.track-header')[1].querySelector('.track-name-input');
    expect(inp).toBeTruthy();
    inp.value = 'Lead';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(renamed).toEqual([[2, 'Lead']]);
  });
  it('remove button calls onRemoveTrack(id)', () => {
    const el = document.createElement('div');
    const removed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onRemoveTrack: (id) => removed.push(id) });
    el.querySelectorAll('.track-header')[1].querySelector('.track-remove').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(removed).toEqual([2]);
  });
  it('snap toggle reflects state and fires onToggleSnap', () => {
    const el = document.createElement('div');
    let t = 0;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, snap: true, onToggleSnap: () => { t++; } });
    const s = el.querySelector('.snap-toggle');
    expect(s.classList.contains('on')).toBe(true);
    s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(t).toBe(1);
  });
  it('mute/solo toggles reflect state and fire handlers', () => {
    const el = document.createElement('div');
    const muted = [], soloed = [];
    const tk = [{ id: 1, name: 'A', armed: true, takes: [], mute: true, solo: false, volume: 0.8, pan: 0 }];
    renderTrackLane(el, { tracks: tk, armedId: 1, onMute: (id) => muted.push(id), onSolo: (id) => soloed.push(id) });
    const h = el.querySelector('.track-header');
    expect(h.querySelector('.track-mute').classList.contains('on')).toBe(true);
    expect(h.querySelector('.track-solo').classList.contains('on')).toBe(false);
    h.querySelector('.track-mute').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    h.querySelector('.track-solo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(muted).toEqual([1]); expect(soloed).toEqual([1]);
  });
  it('volume input fires onVolume(id, value)', () => {
    const el = document.createElement('div');
    const vols = [];
    renderTrackLane(el, { tracks: [{ id: 3, name: 'A', armed: true, takes: [], volume: 0.5, pan: 0 }], armedId: 3, onVolume: (id, v) => vols.push([id, v]) });
    const vol = el.querySelector('.track-vol');
    expect(vol.value).toBe('0.5');
    vol.value = '0.2'; vol.dispatchEvent(new Event('input', { bubbles: true }));
    expect(vols).toEqual([[3, 0.2]]);
  });
  it('clip carries track + take ids and a canvas', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    expect(clip.dataset.trackId).toBe('1');
    expect(clip.dataset.takeId).toBe('1');
    expect(clip.querySelector('canvas.clip-wave')).toBeTruthy();
  });
  it('drag-move calls onMoveClip(trackId, takeId, origLeft+dx)', () => {
    const el = document.createElement('div');
    const moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClip: (tid, n, x, free) => moves.push([tid, n, x, free]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 0, bubbles: true }));
    expect(moves).toEqual([[1, 1, 50, false]]);
  });
  it('drag-out calls onDeleteClip(trackId, takeId)', () => {
    const el = document.createElement('div');
    const dels = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onDeleteClip: (tid, n) => dels.push([tid, n]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -100, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -100, bubbles: true }));
    expect(dels).toEqual([[1, 1]]);
  });
  it('Cmd/Ctrl+click toggles a clip selection without moving it', () => {
    const el = document.createElement('div');
    const moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClips: (m) => moves.push(m) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    expect(clip.classList.contains('selected')).toBe(true);
    expect(moves).toEqual([]); // toggling does not start a drag
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    expect(clip.classList.contains('selected')).toBe(false); // toggles back off
  });
  it('clicking empty timeline clears the selection', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    expect(clip.classList.contains('selected')).toBe(true);
    el.querySelector('.track-scroll').dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
    expect(el.querySelector('.track-clip').classList.contains('selected')).toBe(false);
  });
  it('dragging one of several selected clips moves them all via onMoveClips', () => {
    const el = document.createElement('div');
    const batches = [];
    const two = [{ id: 1, name: 'A', armed: true, takes: [
      { n: 1, name: 'A', x: 10, duration: 2, samples: new Float32Array(4) },
      { n: 2, name: 'B', x: 100, duration: 2, samples: new Float32Array(4) },
    ] }];
    renderTrackLane(el, { tracks: two, armedId: 1, onMoveClips: (m) => batches.push(m) });
    const clips = el.querySelectorAll('.track-clip');
    clips[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    clips[1].dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    expect(clips[0].classList.contains('selected')).toBe(true);
    expect(clips[1].classList.contains('selected')).toBe(true);
    clips[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    clips[0].dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 0, bubbles: true }));
    clips[0].dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 0, bubbles: true }));
    expect(batches).toEqual([[{ trackId: 1, n: 1, x: 50 }, { trackId: 1, n: 2, x: 140 }]]);
    // tidy module-level selection so later suites start clean
    el.querySelector('.track-scroll').dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }));
  });
  it('positions the playhead at playheadSec (preserved across re-renders)', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1, playheadSec: 5 });
    expect(el.querySelector('.track-playhead').style.left).toBe(`${5 * PX_PER_SEC}px`);
  });
  it('getSelectedClips reflects the selection and clears', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    el.querySelector('.track-clip').dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    expect(getSelectedClips()).toEqual([{ trackId: 1, n: 1 }]);
    clearClipSelection();
    expect(getSelectedClips()).toEqual([]);
  });
  it('clips have trim handles on both edges', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    expect(clip.querySelector('.clip-trim-l')).toBeTruthy();
    expect(clip.querySelector('.clip-trim-r')).toBeTruthy();
  });
  it('dragging the right trim handle shortens len via onTrimClip', () => {
    const el = document.createElement('div');
    const trims = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, off, +len.toFixed(2), x]) });
    const h = el.querySelector('.track-clip .clip-trim-r');
    // duration 2 (len 2, width 64px @ 32px/s); drag right edge from 64→32 = −1s → len 1, x unchanged
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 64, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 32, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 32, clientY: 0, bubbles: true }));
    expect(trims).toEqual([[1, 1, 0, 1, 10]]);
  });
  it('dragging the left trim handle moves offset + x', () => {
    const el = document.createElement('div');
    const trims = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, +off.toFixed(2), +len.toFixed(2), x]) });
    const h = el.querySelector('.track-clip .clip-trim-l');
    // drag left edge right by +1s → offset 1, len 1, x = 10 + 32 = 42
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 32, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 32, clientY: 0, bubbles: true }));
    expect(trims).toEqual([[1, 1, 1, 1, 42]]);
  });
});
