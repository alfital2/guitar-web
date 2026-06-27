// tests/knob.test.js
import { describe, it, expect, vi } from 'vitest';
import { valueToAngle, createKnob } from '../src/chain-ui/knob.js';

describe('valueToAngle', () => {
  it('maps min/mid/max across the 270° sweep', () => {
    expect(valueToAngle(0, 0, 10)).toBeCloseTo(-135);
    expect(valueToAngle(10, 0, 10)).toBeCloseTo(135);
    expect(valueToAngle(5, 0, 10)).toBeCloseTo(0);
  });
  it('clamps out-of-range', () => {
    expect(valueToAngle(-5, 0, 10)).toBeCloseTo(-135);
    expect(valueToAngle(99, 0, 10)).toBeCloseTo(135);
  });
});

const param = { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 };

describe('createKnob', () => {
  it('is a focusable slider with aria reflecting the value', () => {
    const { el } = createKnob(param, 2.5, () => {});
    expect(el.getAttribute('role')).toBe('slider');
    expect(el.getAttribute('tabindex')).toBe('0');
    expect(el.getAttribute('aria-valuenow')).toBe('2.5');
  });
  it('ArrowUp increases by step and fires onChange', () => {
    const cb = vi.fn();
    const { el } = createKnob(param, 2.5, cb);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(2.6);
    expect(el.getAttribute('aria-valuenow')).toBe('2.6');
  });
  it('clamps at max', () => {
    const cb = vi.fn();
    const { el } = createKnob(param, 10, cb);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(10);
  });
  it('double-click resets to default', () => {
    const cb = vi.fn();
    const { el } = createKnob(param, 8, cb);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cb).toHaveBeenCalledWith(2.5);
  });
  it('setValue repaints aria without firing onChange', () => {
    const cb = vi.fn();
    const { el, setValue } = createKnob(param, 2.5, cb);
    setValue(7);
    expect(el.getAttribute('aria-valuenow')).toBe('7');
    expect(cb).not.toHaveBeenCalled();
  });
});
