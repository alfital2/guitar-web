import { describe, it, expect, beforeEach } from 'vitest';
import { createTabModel, barTicks, SIXTEENTH } from '../src/tab/tab-model.js';
import { createTabRenderer, COL_W } from '../src/tab/tab-render.js';
import { mountTabLane } from '../src/tab/tab-lane.js';

describe('tab-model tempo + time signature', () => {
  it('setTempo clamps to 30–300 and re-times derived seconds (ticks untouched)', () => {
    const m = createTabModel();
    m.addNote({ tick: 24, string: 3, fret: 5 });           // two quarters in
    m.setTempo(120);
    expect(m.notesWithTime()[0].tSec).toBeCloseTo(1.0, 6);
    m.setTempo(60);
    expect(m.getState().notes[0].tick).toBe(24);
    expect(m.notesWithTime()[0].tSec).toBeCloseTo(2.0, 6); // same ticks, doubled time
    m.setTempo(1);   expect(m.getState().tempo).toBe(30);
    m.setTempo(999); expect(m.getState().tempo).toBe(300);
  });

  it('setTimeSig validates (num 1–12, den ∈ {2,4,8,16}) and re-bars without moving notes', () => {
    const m = createTabModel();
    m.addNote({ tick: 40, string: 0, fret: 0 });
    m.setTimeSig(3, 4);
    expect(m.getState().timeSig).toEqual({ num: 3, den: 4 });
    expect(barTicks(m.getState().timeSig)).toBe(36);
    expect(m.getState().notes[0].tick).toBe(40);           // ticks are absolute
    m.setTimeSig(0, 4); m.setTimeSig(13, 4); m.setTimeSig(4, 5);
    expect(m.getState().timeSig).toEqual({ num: 3, den: 4 });
  });

  it('tempo and TS changes are undoable', () => {
    const m = createTabModel();
    m.setTempo(90);
    m.setTimeSig(6, 8);
    expect(m.undo()).toBe(true);
    expect(m.getState().timeSig).toEqual({ num: 4, den: 4 });
    expect(m.undo()).toBe(true);
    expect(m.getState().tempo).toBe(120);
  });
});

describe('tab-render re-bars from the time signature', () => {
  const UI = { cursor: null, selection: null, currentDur: 3 };
  const render34 = () => {
    const stage = document.createElement('div');
    stage.className = 'tab-stage';
    document.body.appendChild(stage);
    const r = createTabRenderer(stage);
    r.render({
      version: 2, tempo: 120, timeSig: { num: 3, den: 4 }, tuning: 'EADGBE', capo: 0,
      notes: [{ id: 1, tick: 72, durTicks: 3, string: 0, fret: 0, tech: {}, det: null }],
    }, UI);
    return stage;
  };

  it('3/4 puts bar lines every 36 ticks (12 columns), numbered 1-based', () => {
    const stage = render34();
    const lefts = [...stage.querySelectorAll('.tab-bar')].map((b) => b.style.left);
    expect(lefts).toContain(`${(36 / SIXTEENTH) * COL_W}px`);   // bar 2 boundary
    expect(lefts).toContain(`${(72 / SIXTEENTH) * COL_W}px`);   // bar 3 boundary
    const nums = [...stage.querySelectorAll('.tab-barnum')].map((n) => n.textContent);
    expect(nums).toContain('2');
    expect(nums).toContain('3');
  });
});

let container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });
const enter = (el) =>
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

describe('tab-lane header: tempo click-to-edit + TS picker', () => {
  it('shows the mount BPM and commits an edit through the model', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const btn = container.querySelector('.tab-bpm');
    expect(btn.textContent).toBe('120');
    btn.click();
    const input = container.querySelector('.tab-bpm-input');
    input.value = '90';
    enter(input);
    expect(container.querySelector('.tab-bpm').textContent).toBe('90');
    expect(lane.serialize().tempo).toBe(90);
  });

  it('Escape cancels; out-of-range commits clamp through the model', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const btn = container.querySelector('.tab-bpm');
    btn.click();
    let input = container.querySelector('.tab-bpm-input');
    input.value = '90';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(lane.serialize().tempo).toBe(120);
    btn.click();
    input = container.querySelector('.tab-bpm-input');
    input.value = '999';
    enter(input);
    expect(lane.serialize().tempo).toBe(300);
  });

  it('TS picker re-bars through the model', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const sel = container.querySelector('.tab-ts');
    expect(sel.value).toBe('4/4');
    sel.value = '3/4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lane.serialize().timeSig).toEqual({ num: 3, den: 4 });
  });

  it('setBpm (transport tempo) updates the readout — back-compat path', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.setBpm(140);
    expect(container.querySelector('.tab-bpm').textContent).toBe('140');
    expect(lane.serialize().tempo).toBe(140);
  });
});

describe('seeding durTicks from detected durations', () => {
  it('noteOn quantizes meta.durSec to the nearest DURATIONS member (min one 16th)', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.noteOn(3, 5, 4,  { midi: 55, tSec: 0.5, durSec: 0.5 });   // 0.5 s @120 = quarter
    lane.noteOn(3, 7, 8,  { midi: 57, tSec: 1.0, durSec: 0.13 });  // ~3.1 ticks → 16th
    lane.noteOn(3, 9, 12, { midi: 59, tSec: 1.5 });                // no durSec → 16th
    expect(lane.serialize().notes.map((n) => n.durTicks)).toEqual([12, 3, 3]);
  });
});
