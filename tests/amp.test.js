// tests/amp.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderAmp } from '../src/chain-ui/amp.js';

const modules = [
  { instanceId: 10, type: 'drive', schema: { label: 'Drive', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 },
    { key: 'tone', label: 'Tone', min: 0, max: 10, default: 5, step: 0.1 },
  ] }, params: { amount: 2.5, tone: 5 } },
  { instanceId: 11, type: 'eq', schema: { label: 'EQ', params: [
    { key: 'bass', label: 'Bass', min: 0, max: 10, default: 5, step: 0.1 },
  ] }, params: { bass: 6 } },
];

describe('renderAmp', () => {
  it('renders a section per module and a knob per param', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    expect(el.querySelectorAll('.amp-section')).toHaveLength(2);
    expect(el.querySelectorAll('[role=slider]')).toHaveLength(3);
    expect(el.querySelector('.amp-section .amp-section-label').textContent).toBe('Drive');
    expect(el.querySelector('.amp-grille')).toBeTruthy();
    expect(el.querySelector('.amp-panel')).toBeTruthy();
  });
  it('a knob change calls onParamChange(instanceId, key, value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, modules, cb);
    const firstKnob = el.querySelectorAll('.amp-section')[0].querySelector('[role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(10, 'amount', 2.6);
  });
  it('clears on re-render', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    renderAmp(el, modules, () => {});
    expect(el.querySelectorAll('.amp')).toHaveLength(1);
  });
});
