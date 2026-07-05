import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountTabLane } from '../src/tab/tab-lane.js';
import { setCapability } from '../src/features.js';
import { encodeLick, AUTOSAVE_KEY } from '../src/tab/tab-file.js';

let container, lane;
const mount = () => { lane = mountTabLane(container); return lane; };

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  lane?.destroy();                    // kills the pending autosave/flash timers
  lane = null;
  vi.useRealTimers();
  setCapability('tab.file', true);
  setCapability('tab.ascii', true);
  container.remove();
});

const sampleState = () => ({
  version: 2, tempo: 100, timeSig: { num: 4, den: 4 }, tuning: 'EADGBE', capo: 0,
  notes: [{ id: 1, tick: 6, durTicks: 6, string: 2, fret: 7, tech: {}, det: null }],
});

// jsdom has no DataTransfer — a plain Event with an expando carries the files.
const dropFile = (el, file) => {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  ev.dataTransfer = { files: [file] };
  el.dispatchEvent(ev);
};

describe('lane file actions', () => {
  it('renders Save and Open in .tab-file-actions with a hidden .lick file input', () => {
    mount();
    const fa = container.querySelector('.tab-file-actions');
    expect(fa.querySelector('.tab-save')).toBeTruthy();
    expect(fa.querySelector('.tab-open')).toBeTruthy();
    const input = fa.querySelector('input[type=file]');
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe('.lick');
  });

  it('Save downloads <name>.lick', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:lick');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mount();
    lane.getModel().addNote({ tick: 0, string: 3, fret: 5 });
    container.querySelector('.tab-save').click();
    await vi.waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(click.mock.instances[0].download).toBe('lick.lick');
    click.mockRestore();
  });

  it('Open loads a picked .lick into the model and fires onLoadFile', async () => {
    mount();
    const loaded = [];
    lane.onLoadFile((s) => loaded.push(s));
    const file = new File([await encodeLick(sampleState())], 'riff.lick');
    const input = container.querySelector('.tab-file-actions input[type=file]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(lane.getModel().getState().notes).toHaveLength(1));
    expect(lane.getModel().getState().tempo).toBe(100);
    expect(loaded).toHaveLength(1);
    expect(container.querySelector('.tab-state').textContent).toBe('opened riff.lick');
  });

  it('drag-drop of a .lick loads it; dragover marks the lane', async () => {
    mount();
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    container.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(container.classList.contains('tab-drop')).toBe(true);
    dropFile(container, new File([await encodeLick(sampleState())], 'dropped.lick'));
    expect(container.classList.contains('tab-drop')).toBe(false);
    await vi.waitFor(() => expect(lane.getModel().getState().notes).toHaveLength(1));
  });

  it('a broken file flashes the decode error on .tab-state', async () => {
    mount();
    dropFile(container, new File([new Uint8Array([9, 9, 9, 9, 9, 9])], 'song.mp3'));
    await vi.waitFor(() =>
      expect(container.querySelector('.tab-state').textContent).toBe('Not a .lick file'));
    expect(lane.getModel().getState().notes).toHaveLength(0);
  });

  it('autosaves 800 ms after the LAST edit (debounced)', () => {
    vi.useFakeTimers();
    mount();
    const model = lane.getModel();
    model.addNote({ tick: 0, string: 3, fret: 5 });
    vi.advanceTimersByTime(500);
    model.addNote({ tick: 3, string: 3, fret: 7 });          // resets the clock
    vi.advanceTimersByTime(799);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    const saved = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
    expect(saved.notes).toHaveLength(2);                     // one write, latest state
  });

  it('restores the autosaved working copy when the lane mounts empty', () => {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(sampleState()));
    mount();
    expect(lane.getModel().getState().notes).toHaveLength(1);
    expect(lane.getModel().getState().tempo).toBe(100);
  });

  it("can('tab.file') off → Save/Open locked and inert, drop ignored", async () => {
    setCapability('tab.file', false);
    URL.createObjectURL = vi.fn();
    mount();
    const save = container.querySelector('.tab-save');
    const open = container.querySelector('.tab-open');
    expect(save.disabled).toBe(true);
    expect(save.classList.contains('tab-locked')).toBe(true);
    expect(open.disabled).toBe(true);
    save.click();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    dropFile(container, new File([await encodeLick(sampleState())], 'riff.lick'));
    await new Promise((r) => setTimeout(r, 20));
    expect(lane.getModel().getState().notes).toHaveLength(0);
  });
});

describe('lane ASCII copy', () => {
  it('renders the ASCII button next to Save/Open', () => {
    mount();
    expect(container.querySelector('.tab-file-actions .tab-ascii')).toBeTruthy();
  });

  it('copies toAscii(state) to the clipboard and flashes confirmation', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    lane.getModel().addNote({ tick: 0, string: 3, fret: 5 });
    container.querySelector('.tab-ascii').click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0];
    expect(text.split('\n')).toHaveLength(6);
    expect(text).toContain('D|5-');
    expect(container.querySelector('.tab-state').textContent).toBe('ASCII tab copied');
  });

  it("can('tab.ascii') off → button locked, clipboard untouched, Save unaffected", () => {
    setCapability('tab.ascii', false);
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    const btn = container.querySelector('.tab-ascii');
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('tab-locked')).toBe(true);
    expect(container.querySelector('.tab-save').disabled).toBe(false);   // separate cap
    btn.click();
    expect(writeText).not.toHaveBeenCalled();
  });
});
