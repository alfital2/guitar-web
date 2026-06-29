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
  });
});
