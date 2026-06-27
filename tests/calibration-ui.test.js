// tests/calibration-ui.test.js
import { describe, it, expect, vi } from 'vitest';
import { renderCalibrationControls } from '../src/calibration/ui.js';

function setup(over = {}) {
  const el = document.createElement('div');
  const handlers = { onSelect: vi.fn(), onStrength: vi.fn(), onCalibrate: vi.fn() };
  renderCalibrationControls(el, { profiles: [{ name: 'Strat' }, { name: 'LP' }], activeName: 'LP', strength: 0.65, ...over }, handlers);
  return { el, handlers };
}

describe('renderCalibrationControls', () => {
  it('lists None + profiles and preselects active', () => {
    const { el } = setup();
    const opts = [...el.querySelectorAll('option')].map(o => o.textContent);
    expect(opts).toEqual(['None', 'Strat', 'LP']);
    expect(el.querySelector('select').value).toBe('LP');
  });
  it('select change fires onSelect (None -> null)', () => {
    const { el, handlers } = setup();
    const sel = el.querySelector('select');
    sel.value = ''; sel.dispatchEvent(new Event('change'));
    expect(handlers.onSelect).toHaveBeenCalledWith(null);
    sel.value = 'Strat'; sel.dispatchEvent(new Event('change'));
    expect(handlers.onSelect).toHaveBeenCalledWith('Strat');
  });
  it('strength slider fires onStrength with a number', () => {
    const { el, handlers } = setup();
    const r = el.querySelector('input[type=range]');
    r.value = '0.4'; r.dispatchEvent(new Event('input'));
    expect(handlers.onStrength).toHaveBeenCalledWith(0.4);
  });
  it('calibrate button fires onCalibrate', () => {
    const { el, handlers } = setup();
    el.querySelector('button').dispatchEvent(new Event('click'));
    expect(handlers.onCalibrate).toHaveBeenCalled();
  });
});
