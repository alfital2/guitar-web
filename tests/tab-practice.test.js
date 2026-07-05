// tests/tab-practice.test.js — the practice pack header controls on the lane:
// speed 50/75/100, metronome/count-in/loop toggles, all gated by
// can('tab.practice'). getPractice() is what main.js spreads into
// tabMidi.play(), with the loop already resolved to a whole-bar seconds
// window from the current selection.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mountTabLane } from '../src/tab/tab-lane.js';
import { setCapability } from '../src/features.js';

let container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { setCapability('tab.practice', true); });   // registry is module-global — always restore

describe('practice header controls', () => {
  it('defaults: everything off, full speed', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    expect(lane.getPractice()).toEqual({ metronome: false, countIn: false, loop: null, speed: 1 });
  });

  it('metronome / count-in toggles flip state and reflect .on', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const metro = container.querySelector('.tab-metro');
    const count = container.querySelector('.tab-countin');
    metro.click(); count.click();
    expect(metro.classList.contains('on')).toBe(true);
    expect(count.classList.contains('on')).toBe(true);
    const p = lane.getPractice();
    expect(p.metronome).toBe(true);
    expect(p.countIn).toBe(true);
    metro.click();
    expect(lane.getPractice().metronome).toBe(false);
  });

  it('speed select feeds getPractice', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const sel = container.querySelector('.tab-speed');
    sel.value = '0.75';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.getPractice().speed).toBe(0.75);
  });

  it('loop with no selection covers the whole tab in full bars', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.noteOn(3, 5, 4, { midi: 55, tSec: 0.5, durSec: 0.3 });   // tick 12 — inside bar 1
    container.querySelector('.tab-loop').click();
    expect(lane.getPractice().loop).toEqual({ startSec: 0, endSec: 2 });   // one 4/4 bar at 120
  });

  it("can('tab.practice') off → locked, disabled, inert", () => {
    setCapability('tab.practice', false);
    const lane = mountTabLane(container, { bpm: 120 });
    const metro = container.querySelector('.tab-metro');
    expect(metro.disabled).toBe(true);
    expect(metro.classList.contains('locked')).toBe(true);
    expect(container.querySelector('.tab-speed').disabled).toBe(true);
    metro.click();                                                 // guarded even if click sneaks through
    expect(lane.getPractice()).toEqual({ metronome: false, countIn: false, loop: null, speed: 1 });
  });
});
