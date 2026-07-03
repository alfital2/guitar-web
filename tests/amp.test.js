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
  it('renders a group per module and a knob per param', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    expect(el.querySelectorAll('.amp-group')).toHaveLength(2);
    expect(el.querySelectorAll('[role=slider]')).toHaveLength(3);
    expect(el.querySelector('.amp-group .amp-group-head').textContent).toBe('Drive');
    expect(el.querySelector('.amp-grille')).toBeTruthy();
    expect(el.querySelector('.amp-panel')).toBeTruthy();
  });
  it('a knob change calls onParamChange(instanceId, key, value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, modules, cb);
    const firstKnob = el.querySelectorAll('.amp-group')[0].querySelector('[role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(10, 'amount', 2.6);
  });
  it('clears on re-render', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    renderAmp(el, modules, () => {});
    expect(el.querySelectorAll('.amp-head')).toHaveLength(1);
  });

  it('builds a value strip with a chip per knob (label + current value)', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    const chips = el.querySelectorAll('.amp-vstrip-chip');
    expect(chips).toHaveLength(3);
    // first knob: amount = 2.5
    expect(chips[0].querySelector('.amp-vstrip-val').textContent).toBe('2.5');
    expect(chips[0].querySelector('.amp-vstrip-lbl').textContent).toBe('Amount');
    // strip is grouped by section
    expect(el.querySelectorAll('.amp-vstrip-sec-head')).toHaveLength(2);
  });

  it('defaults to collapsed', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {});
    expect(el.querySelector('.amp-wrap').classList.contains('collapsed')).toBe(true);
  });

  it('respects collapsed:false', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {}, { collapsed: false });
    expect(el.querySelector('.amp-wrap').classList.contains('collapsed')).toBe(false);
  });

  it('clicking the strip expands and fires onCollapse(false)', () => {
    const el = document.createElement('div');
    const onCollapse = vi.fn();
    renderAmp(el, modules, () => {}, { collapsed: true, onCollapse });
    el.querySelector('.amp-vstrip').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.amp-wrap').classList.contains('collapsed')).toBe(false);
    expect(onCollapse).toHaveBeenCalledWith(false);
  });

  it('the collapse button folds back and fires onCollapse(true)', () => {
    const el = document.createElement('div');
    const onCollapse = vi.fn();
    renderAmp(el, modules, () => {}, { collapsed: false, onCollapse });
    el.querySelector('.amp-collapse-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el.querySelector('.amp-wrap').classList.contains('collapsed')).toBe(true);
    expect(onCollapse).toHaveBeenCalledWith(true);
  });
});

describe('renderAmp neuralamp head', () => {
  const neuralModule = () => ({
    instanceId: 20,
    type: 'neuralamp',
    schema: {
      label: 'Neural Amp',
      params: [
        { key: 'model', label: 'Amp', min: 0, max: 4, default: 0, step: 1 },
        { key: 'trim', label: 'Trim', min: 0, max: 10, default: 5, step: 0.1 },
        { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
      ],
    },
    params: { model: 2, trim: 5, level: 5 },
  });

  it('does NOT render a model select (model is chosen from the preset browser) — only Trim/Level knobs', () => {
    const el = document.createElement('div');
    renderAmp(el, [neuralModule()], () => {}, { collapsed: false });
    // The on-amp model <select> was removed — it duplicated the 05 Professional list.
    expect(el.querySelector('.amp-model-select')).toBeNull();
    expect(el.querySelector('select')).toBeNull();
    // 'model' is not a knob either → only Trim + Level are sliders.
    expect(el.querySelectorAll('[role=slider]')).toHaveLength(2);
    const labels = [...el.querySelectorAll('.amp-knob-label')].map((l) => l.textContent);
    expect(labels).toEqual(['Trim', 'Level']);
  });

  it('a Trim knob change fires onParamChange(instanceId, "trim", value)', () => {
    const el = document.createElement('div');
    const cb = vi.fn();
    renderAmp(el, [neuralModule()], cb, { collapsed: false });
    const firstKnob = el.querySelector('.amp-group [role=slider]');
    expect(firstKnob.getAttribute('aria-label')).toBe('Trim');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(cb).toHaveBeenCalledWith(20, 'trim', 5.1);
  });
});

// Unified collapse affordance: same chevron style + aria-expanded pattern as
// the pedalboard and the preset browser, keyboard-operable strip, and the
// silent programmatic collapse hook the transport auto-fold uses.
describe('unified collapse affordance (amp)', () => {
  it('collapse chevron carries .collapse-chev and aria-expanded="true"', () => {
    const el = document.createElement('div');
    renderAmp(el, modules, () => {}, { collapsed: false });
    const btn = el.querySelector('.amp-collapse-btn');
    expect(btn.classList.contains('collapse-chev')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('strip is a keyboard-focusable button; Enter/Space expands', () => {
    const el = document.createElement('div');
    const onCollapse = vi.fn();
    renderAmp(el, modules, () => {}, { collapsed: true, onCollapse });
    const strip = el.querySelector('.amp-vstrip');
    expect(strip.getAttribute('role')).toBe('button');
    expect(strip.getAttribute('tabindex')).toBe('0');
    expect(strip.getAttribute('aria-expanded')).toBe('false');
    strip.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onCollapse).toHaveBeenCalledWith(false);
    expect(el.querySelector('.amp-wrap').classList.contains('collapsed')).toBe(false);
  });

  it('silent amp-set-collapsed event folds/unfolds WITHOUT firing onCollapse', () => {
    const el = document.createElement('div');
    const onCollapse = vi.fn();
    renderAmp(el, modules, () => {}, { collapsed: false, onCollapse });
    const wrap = el.querySelector('.amp-wrap');
    wrap.dispatchEvent(new CustomEvent('amp-set-collapsed', { detail: { collapsed: true } }));
    expect(wrap.classList.contains('collapsed')).toBe(true);
    wrap.dispatchEvent(new CustomEvent('amp-set-collapsed', { detail: { collapsed: false } }));
    expect(wrap.classList.contains('collapsed')).toBe(false);
    expect(onCollapse).not.toHaveBeenCalled();
  });
});
