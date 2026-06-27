import { describe, it, expect, vi } from 'vitest';
import { renderChain, renderPresetPicker } from '../src/ui.js';

const modules = [
  { type: 'eq', schema: { label: 'EQ', params: [{ key: 'bass', label: 'Bass', min: 0, max: 10, default: 5, step: 0.1 }] }, params: { bass: 6 } },
];

describe('renderChain', () => {
  it('renders a slider per param with current value', () => {
    const el = document.createElement('div');
    renderChain(el, modules, () => {});
    const slider = el.querySelector('input[type=range]');
    expect(slider).toBeTruthy();
    expect(slider.value).toBe('6');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('10');
  });
  it('calls onParamChange with (index, key, number) on input', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderChain(el, modules, cb);
    const slider = el.querySelector('input[type=range]');
    slider.value = '8';
    slider.dispatchEvent(new Event('input'));
    expect(cb).toHaveBeenCalledWith(0, 'bass', 8);
  });
});

describe('renderPresetPicker', () => {
  it('lists presets and fires onSelect', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    const presets = [{ name: 'A', chain: [] }, { name: 'B', chain: [] }];
    renderPresetPicker(el, presets, cb);
    const select = el.querySelector('select');
    expect(select.options).toHaveLength(2);
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    expect(cb).toHaveBeenCalledWith(presets[1]);
  });
});
