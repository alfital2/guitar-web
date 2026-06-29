// tests/track-lane.test.js
import { describe, it, expect } from 'vitest';
import { renderTrackLane } from '../src/track-lane.js';

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
  it('armed track header has .armed and its arm button .on', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 2 });
    const headers = el.querySelectorAll('.track-header');
    expect(headers[1].classList.contains('armed')).toBe(true);
    expect(headers[1].querySelector('.track-rec').classList.contains('on')).toBe(true);
    expect(headers[0].classList.contains('armed')).toBe(false);
  });
  it('clicking another track arm button calls onArm(id)', () => {
    const el = document.createElement('div');
    const armed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onArm: (id) => armed.push(id) });
    el.querySelectorAll('.track-header')[1].querySelector('.track-rec').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(armed).toEqual([2]);
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
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClip: (tid, n, x) => moves.push([tid, n, x]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 0, bubbles: true }));
    expect(moves).toEqual([[1, 1, 50]]);
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
});
