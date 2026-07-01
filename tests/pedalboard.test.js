// tests/pedalboard.test.js
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderPedalboard, computeDrop } from '../src/chain-ui/pedalboard.js';

afterEach(() => {
  document.querySelectorAll('.fx-modal, .fx-modal-backdrop, .fx-ghost').forEach((n) => n.remove());
});

const units = [
  { instanceId: 1, type: 'compressor', locked: false, schema: { label: 'Compressor', params: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, default: -24, step: 1 },
  ] }, params: { threshold: -24 } },
  { instanceId: 2, type: 'drive', locked: true, schema: { label: 'Drive', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 },
  ] }, params: { amount: 2.5 } },
  { instanceId: 3, type: 'cabinet', locked: true, schema: { label: 'Cabinet', params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, default: 1, step: 0.01 },
  ] }, params: { mix: 1 } },
  { instanceId: 4, type: 'delay', locked: false, schema: { label: 'Delay', params: [
    { key: 'mix', label: 'Mix', min: 0, max: 1, default: 0.2, step: 0.01 },
  ] }, params: { mix: 0.2 } },
];
const noop = { onParamChange() {}, onAdd() {}, onRemove() {}, onMove() {} };

describe('renderPedalboard', () => {
  it('renders a card only for non-locked units', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.pedal')).toHaveLength(2); // compressor + delay
    expect(el.querySelector('.pedal').dataset.instanceId).toBe('1');
  });
  it('renders the AMP anchor at the amp block position', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.amp-anchor')).toHaveLength(1);
    // order: compressor card, connector, amp anchor, connector, delay card
    const kinds = [...el.querySelector('.pedalboard').children]
      .filter(c => c.classList.contains('pedal') || c.classList.contains('amp-anchor') || c.classList.contains('connector'))
      .map(c => c.classList.contains('amp-anchor') ? 'AMP' : (c.classList.contains('pedal') ? c.dataset.instanceId : '>'));
    expect(kinds).toEqual(['1', '>', 'AMP', '>', '4']);
  });
  it('renders a + add tile that opens the effects window with pedal types', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    const add = el.querySelector('.pedal-add');
    expect(add).toBeTruthy();
    add.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const modal = document.querySelector('.fx-modal');
    expect(modal).toBeTruthy();
    const opts = [...document.querySelectorAll('.fx-tile')].map(b => b.dataset.type);
    for (const t of ['compressor', 'delay', 'pingpong', 'chorus']) expect(opts).toContain(t);
    // amp types never appear in the effects window
    expect(opts).not.toContain('drive');
    expect(opts).not.toContain('eq');
    expect(opts).not.toContain('cabinet');
    // reverb is a built-in amp stage now, not an addable pedal
    expect(opts).not.toContain('reverb');
  });
  it('clicking an effects-window tile calls onAdd(type) and closes', () => {
    const el = document.createElement('div');
    const onAdd = vi.fn();
    renderPedalboard(el, units, { ...noop, onAdd });
    el.querySelector('.pedal-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const tile = document.querySelector('.fx-tile[data-type="pingpong"]');
    tile.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    tile.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 0, clientY: 0 }));
    expect(onAdd).toHaveBeenCalledWith('pingpong');
    expect(document.querySelector('.fx-modal')).toBeNull();
  });
  it('a knob change calls onParamChange(instanceId, key, value)', () => {
    const el = document.createElement('div');
    const onParamChange = vi.fn();
    renderPedalboard(el, units, { ...noop, onParamChange });
    const firstKnob = el.querySelector('.pedal [role=slider]');
    firstKnob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onParamChange).toHaveBeenCalledWith(1, 'threshold', -23);
  });
  it('clears the container on re-render', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    renderPedalboard(el, units, noop);
    expect(el.querySelectorAll('.pedalboard')).toHaveLength(1);
  });
  it('renders bespoke faceplate art, a drag grip, knobs, and width on a pedal', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    const pedal = el.querySelector('.pedal');
    // WOW UI: bespoke art renders as a plate with a per-effect motif + lens.
    expect(pedal.querySelector('.pedal-plate .pedal-motif')).toBeTruthy();
    expect(pedal.querySelector('.pedal-plate .pedal-lens')).toBeTruthy();
    expect(pedal.querySelector('.pedal-grip[data-drag-handle]')).toBeTruthy();
    expect(pedal.querySelector('.pedal-knobs .knob')).toBeTruthy();
    expect(pedal.style.width).toMatch(/\d+px/); // width derives from knob count
  });
  it('renders cover art thumbnails in the palette tiles', () => {
    const el = document.createElement('div');
    renderPedalboard(el, units, noop);
    el.querySelector('.pedal-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const tile = document.querySelector('.fx-tile[data-type="pingpong"]');
    // WOW UI: tiles render a mini pedal plate with the effect motif SVG.
    expect(tile.querySelector('.fx-tile-plate svg')).toBeTruthy();
    expect(tile.querySelector('.fx-tile-gloss')).toBeTruthy();
  });
});

describe('computeDrop', () => {
  function boardWith(ids) {
    const board = document.createElement('div');
    board.className = 'pedalboard';
    ids.forEach((id, i) => {
      const p = document.createElement('div');
      p.className = 'pedal'; p.dataset.instanceId = String(id);
      // 100px-wide cards starting at x=0,100,200…
      p.getBoundingClientRect = () => ({ left: i * 100, right: i * 100 + 100, width: 100, top: 0, bottom: 50, height: 50, x: i * 100, y: 0 });
      board.appendChild(p);
    });
    return board;
  }
  it('returns the id of the card whose left half the cursor is over', () => {
    const board = boardWith([1, 4, 7]);
    expect(computeDrop(board, 10)).toBe(1);   // left of card 1 -> before 1
    expect(computeDrop(board, 160)).toBe(7);  // right half of card 4 -> before 7
  });
  it('returns null past the last card (drop at end)', () => {
    const board = boardWith([1, 4, 7]);
    expect(computeDrop(board, 290)).toBeNull();
  });
});
