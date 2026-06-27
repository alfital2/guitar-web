// tests/pedalboard.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderPedalboard } from '../src/chain-ui/pedalboard.js';

const modules = [
  { type: 'drive', schema: { label: 'Drive', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 },
    { key: 'tone', label: 'Tone', min: 0, max: 10, default: 5, step: 0.1 },
  ] }, params: { amount: 2.5, tone: 5 } },
  { type: 'reverb', schema: { label: 'Reverb', params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.3, step: 0.01 },
  ] }, params: { mix: 0.3 } },
];

describe('renderPedalboard', () => {
  it('renders a brick per module with a knob per param', () => {
    const el = document.createElement('div');
    renderPedalboard(el, modules, () => {});
    expect(el.querySelectorAll('.pedal')).toHaveLength(2);
    expect(el.querySelectorAll('.pedal')[0].querySelectorAll('[role=slider]')).toHaveLength(2);
    expect(el.querySelector('.pedal-name').textContent).toBe('Drive');
  });
  it('puts a connector between bricks (n-1)', () => {
    const el = document.createElement('div');
    renderPedalboard(el, modules, () => {});
    expect(el.querySelectorAll('.connector')).toHaveLength(1);
  });
  it('a knob change calls onParamChange(index, key, value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderPedalboard(el, modules, cb);
    const firstKnob = el.querySelectorAll('.pedal')[0].querySelector('[role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(0, 'amount', 2.6);
  });
  it('clears the container on re-render', () => {
    const el = document.createElement('div');
    renderPedalboard(el, modules, () => {});
    renderPedalboard(el, modules, () => {});
    expect(el.querySelectorAll('.pedal')).toHaveLength(2);
  });
});
