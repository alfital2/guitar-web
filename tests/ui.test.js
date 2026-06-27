import { describe, it, expect, vi } from 'vitest';
import { renderPresetPicker } from '../src/ui.js';

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
