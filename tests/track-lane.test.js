// tests/track-lane.test.js
import { describe, it, expect } from 'vitest';
import { renderTrackLane } from '../src/track-lane.js';

describe('renderTrackLane', () => {
  it('renders a header with the preset name', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'Echo Studio' });
    expect(el.querySelector('.track-header')).toBeTruthy();
    expect(el.querySelector('.track-name').textContent).toBe('Echo Studio');
  });
  it('renders a numbered bar ruler with `bars` cells', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'X', bars: 8 });
    const cells = [...el.querySelectorAll('.track-bar')];
    expect(cells).toHaveLength(8);
    expect(cells.map(c => c.textContent)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });
  it('defaults to 16 bars', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'X' });
    expect(el.querySelectorAll('.track-bar')).toHaveLength(16);
  });
  it('renders exactly one playhead', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'X' });
    expect(el.querySelectorAll('.track-playhead')).toHaveLength(1);
  });
  it('shows an em dash when the preset name is empty', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: '' });
    expect(el.querySelector('.track-name').textContent).toBe('—');
  });
  it('clears on re-render', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'A' });
    renderTrackLane(el, { presetName: 'B' });
    expect(el.querySelectorAll('.track-header')).toHaveLength(1);
    expect(el.querySelector('.track-name').textContent).toBe('B');
  });
  it('renders a clip per take with label and canvas', () => {
    const el = document.createElement('div');
    const takes = [
      { n: 1, name: 'Echo Studio', duration: 4, x: 0, samples: new Float32Array(8) },
      { n: 2, name: 'Echo Studio', duration: 2, x: 128, samples: new Float32Array(4) },
    ];
    renderTrackLane(el, { presetName: 'Echo Studio', takes });
    const clips = [...el.querySelectorAll('.track-clip')];
    expect(clips).toHaveLength(2);
    expect(clips[0].querySelector('.clip-label').textContent).toBe('Echo Studio #1');
    expect(clips[1].querySelector('.clip-label').textContent).toBe('Echo Studio #2');
    expect(clips[0].querySelector('canvas.clip-wave')).toBeTruthy();
    expect(clips[0].dataset.takeId).toBe('1');
  });
  it('dragging a clip horizontally calls onMoveClip(n, origLeft+dx)', () => {
    const el = document.createElement('div');
    const moves = [];
    renderTrackLane(el, { presetName: 'P', takes: [{ n: 1, name: 'P', duration: 2, x: 10, samples: new Float32Array(4) }], onMoveClip: (n, x) => moves.push([n, x]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 0, bubbles: true }));
    expect(moves).toEqual([[1, 50]]); // 10 + (140-100)
  });
  it('renders a snap toggle reflecting state and a playhead grip', () => {
    const el = document.createElement('div');
    let toggled = 0;
    renderTrackLane(el, { presetName: 'P', snap: true, onToggleSnap: () => { toggled++; } });
    const snap = el.querySelector('.snap-toggle');
    expect(snap).toBeTruthy();
    expect(snap.classList.contains('on')).toBe(true);
    snap.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggled).toBe(1);
    expect(el.querySelector('.track-playhead .playhead-grip')).toBeTruthy();
  });
  it('snap toggle is off when snap=false', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { presetName: 'P', snap: false });
    expect(el.querySelector('.snap-toggle').classList.contains('on')).toBe(false);
  });
  it('dragging a clip out of the lane calls onDeleteClip(n)', () => {
    const el = document.createElement('div');
    const dels = [];
    renderTrackLane(el, { presetName: 'P', takes: [{ n: 2, name: 'P', duration: 1, x: 0, samples: new Float32Array(2) }], onDeleteClip: (n) => dels.push(n) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -100, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -100, bubbles: true }));
    expect(dels).toEqual([2]);
  });
});
