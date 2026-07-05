// tests/track-lane.test.js
import { describe, it, expect } from 'vitest';
import { renderTrackLane, PX_PER_SEC, getSelectedClips, clearClipSelection, loopRepeatFromDrag } from '../src/track-lane.js';

function tracks() {
  return [
    { id: 1, name: 'Echo Studio', armed: true, takes: [{ n: 1, name: 'Echo Studio', x: 10, duration: 2, samples: new Float32Array(4) }] },
    { id: 2, name: 'Crunch', armed: false, takes: [] },
  ];
}

describe('renderTrackLane (multi-track)', () => {
  it('renders one header and one strip per track', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    expect(el.querySelectorAll('.track-header')).toHaveLength(2);
    expect(el.querySelectorAll('.track-strip')).toHaveLength(2);
    expect(el.querySelector('.track-header .track-name').textContent).toBe('Echo Studio');
  });
  it('has one shared ruler and one playhead regardless of track count', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    expect(el.querySelectorAll('.track-ruler')).toHaveLength(1);
    expect(el.querySelectorAll('.track-playhead')).toHaveLength(1);
    expect(el.querySelector('.track-playhead .playhead-grip')).toBeTruthy();
  });
  it('add-track control calls onAddTrack', () => {
    const el = document.createElement('div');
    let added = 0;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onAddTrack: () => { added++; } });
    el.querySelector('.track-add').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(added).toBe(1);
  });
  it('armed track header has .armed (bright box, no arm button)', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 2 });
    const headers = el.querySelectorAll('.track-header');
    expect(headers[1].classList.contains('armed')).toBe(true);
    expect(headers[0].classList.contains('armed')).toBe(false);
    expect(headers[1].querySelector('.track-rec')).toBeNull(); // arm button removed
  });
  it('clicking a track header body calls onArm(id)', () => {
    const el = document.createElement('div');
    const armed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onArm: (id) => armed.push(id) });
    el.querySelectorAll('.track-header')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(armed).toEqual([2]);
  });
  it('clicking the track name enters rename, Enter commits onRename', () => {
    const el = document.createElement('div');
    const renamed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onRename: (id, name) => renamed.push([id, name]) });
    el.querySelectorAll('.track-header')[1].querySelector('.track-name').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const inp = el.querySelectorAll('.track-header')[1].querySelector('.track-name-input');
    expect(inp).toBeTruthy();
    inp.value = 'Lead';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(renamed).toEqual([[2, 'Lead']]);
  });
  it('remove button calls onRemoveTrack(id)', () => {
    const el = document.createElement('div');
    const removed = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onRemoveTrack: (id) => removed.push(id) });
    el.querySelectorAll('.track-header')[1].querySelector('.track-remove').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(removed).toEqual([2]);
  });
  it('snap toggle reflects state and fires onToggleSnap', () => {
    const el = document.createElement('div');
    let t = 0;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, snap: true, onToggleSnap: () => { t++; } });
    const s = el.querySelector('.snap-toggle');
    expect(s.classList.contains('on')).toBe(true);
    s.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(t).toBe(1);
  });
  it('mute/solo toggles reflect state and fire handlers', () => {
    const el = document.createElement('div');
    const muted = [], soloed = [];
    const tk = [{ id: 1, name: 'A', armed: true, takes: [], mute: true, solo: false, volume: 0.8, pan: 0 }];
    renderTrackLane(el, { tracks: tk, armedId: 1, onMute: (id) => muted.push(id), onSolo: (id) => soloed.push(id) });
    const h = el.querySelector('.track-header');
    expect(h.querySelector('.track-mute').classList.contains('on')).toBe(true);
    expect(h.querySelector('.track-solo').classList.contains('on')).toBe(false);
    h.querySelector('.track-mute').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    h.querySelector('.track-solo').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(muted).toEqual([1]); expect(soloed).toEqual([1]);
  });
  it('volume input fires onVolume(id, value)', () => {
    const el = document.createElement('div');
    const vols = [];
    renderTrackLane(el, { tracks: [{ id: 3, name: 'A', armed: true, takes: [], volume: 0.5, pan: 0 }], armedId: 3, onVolume: (id, v) => vols.push([id, v]) });
    const vol = el.querySelector('.track-vol');
    expect(vol.value).toBe('0.5');
    vol.value = '0.2'; vol.dispatchEvent(new Event('input', { bubbles: true }));
    expect(vols).toEqual([[3, 0.2]]);
  });
  it('clip carries track + take ids and a canvas', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    expect(clip.dataset.trackId).toBe('1');
    expect(clip.dataset.takeId).toBe('1');
    expect(clip.querySelector('canvas.clip-wave')).toBeTruthy();
  });
  it('drag-move calls onMoveClip(trackId, takeId, origLeft+dx)', () => {
    const el = document.createElement('div');
    const moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClip: (tid, n, x, free) => moves.push([tid, n, x, free]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 100, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 0, bubbles: true }));
    expect(moves).toEqual([[1, 1, 50, false]]);
  });
  it('drag-out calls onDeleteClip(trackId, takeId)', () => {
    const el = document.createElement('div');
    const dels = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onDeleteClip: (tid, n) => dels.push([tid, n]) });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 0, clientY: -100, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 0, clientY: -100, bubbles: true }));
    expect(dels).toEqual([[1, 1]]);
  });
  it('Cmd/Ctrl+click toggles a clip selection without moving it', () => {
    const el = document.createElement('div');
    const moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClips: (m) => moves.push(m) });
    const clip = el.querySelector('.track-clip');
    const metaClick = () => {
      clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
      clip.dispatchEvent(new MouseEvent('pointerup', { button: 0, metaKey: true, bubbles: true })); // click = down+up, no move
    };
    metaClick();
    expect(clip.classList.contains('selected')).toBe(true);
    expect(moves).toEqual([]); // toggling does not start a drag
    metaClick();
    expect(clip.classList.contains('selected')).toBe(false); // toggles back off
  });
  it('clicking empty timeline clears the selection', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { button: 0, metaKey: true, bubbles: true }));
    expect(clip.classList.contains('selected')).toBe(true);
    // plain click on empty timeline (down + up, no drag) clears the selection
    el.querySelector('.track-scroll').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 5, bubbles: true }));
    expect(el.querySelector('.track-clip').classList.contains('selected')).toBe(false);
  });
  it('marquee drag box-selects the clips it covers', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const scroll = el.querySelector('.track-scroll');
    scroll.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 60, bubbles: true }));
    expect(el.querySelector('.marquee')).toBeTruthy();          // box drawn past the threshold
    expect(getSelectedClips().length).toBeGreaterThan(0);       // covered clip selected
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 60, bubbles: true }));
    expect(el.querySelector('.marquee')).toBeNull();            // box removed on release
    clearClipSelection();
  });
  it('dragging one of several selected clips moves them all via onMoveClips', () => {
    const el = document.createElement('div');
    const batches = [];
    const two = [{ id: 1, name: 'A', armed: true, takes: [
      { n: 1, name: 'A', x: 10, duration: 2, samples: new Float32Array(4) },
      { n: 2, name: 'B', x: 100, duration: 2, samples: new Float32Array(4) },
    ] }];
    renderTrackLane(el, { tracks: two, armedId: 1, onMoveClips: (m) => batches.push(m) });
    const clips = el.querySelectorAll('.track-clip');
    const metaClick = (c) => {
      c.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
      c.dispatchEvent(new MouseEvent('pointerup', { button: 0, metaKey: true, bubbles: true }));
    };
    metaClick(clips[0]);
    metaClick(clips[1]);
    expect(clips[0].classList.contains('selected')).toBe(true);
    expect(clips[1].classList.contains('selected')).toBe(true);
    clips[0].dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    clips[0].dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 0, bubbles: true }));
    clips[0].dispatchEvent(new MouseEvent('pointerup', { clientX: 40, clientY: 0, bubbles: true }));
    expect(batches).toEqual([[{ trackId: 1, n: 1, x: 50 }, { trackId: 1, n: 2, x: 140 }]]);
    // tidy module-level selection so later suites start clean
    el.querySelector('.track-scroll').dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 5, clientY: 5, bubbles: true }));
  });
  it('Cmd/Ctrl+drag free-moves a clip (free flag → true, no grid snap)', () => {
    const el = document.createElement('div');
    let freeFlag = null;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClips: (m, free) => { freeFlag = free; } });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, ctrlKey: true, clientX: 0, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { ctrlKey: true, clientX: 40, clientY: 0, bubbles: true })); // real drag (>3px)
    clip.dispatchEvent(new MouseEvent('pointerup', { ctrlKey: true, clientX: 40, clientY: 0, bubbles: true }));
    expect(freeFlag).toBe(true); // Ctrl held → placement is free (no snap)
    clearClipSelection();
  });
  it('pressing Ctrl mid-drag (held only at release) still frees the placement', () => {
    const el = document.createElement('div');
    let freeFlag = null;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClips: (m, free) => { freeFlag = free; } });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 0, bubbles: true })); // grabbed WITHOUT modifier
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { ctrlKey: true, clientX: 80, clientY: 0, bubbles: true })); // Ctrl pressed by drop time
    expect(freeFlag).toBe(true);
    clearClipSelection();
  });
  it('a plain drag (no modifier) snaps — free flag → false', () => {
    const el = document.createElement('div');
    let freeFlag = null;
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onMoveClips: (m, free) => { freeFlag = free; } });
    const clip = el.querySelector('.track-clip');
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 80, clientY: 0, bubbles: true }));
    expect(freeFlag).toBe(false);
    clearClipSelection();
  });
  it('positions the playhead at playheadSec (preserved across re-renders)', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1, playheadSec: 5 });
    expect(el.querySelector('.track-playhead').style.left).toBe(`${5 * PX_PER_SEC}px`);
  });
  it('getSelectedClips reflects the selection and clears', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const c = el.querySelector('.track-clip');
    c.dispatchEvent(new MouseEvent('pointerdown', { button: 0, metaKey: true, bubbles: true }));
    c.dispatchEvent(new MouseEvent('pointerup', { button: 0, metaKey: true, bubbles: true }));
    expect(getSelectedClips()).toEqual([{ trackId: 1, n: 1 }]);
    clearClipSelection();
    expect(getSelectedClips()).toEqual([]);
  });
  it('clips have trim handles on both edges', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    expect(clip.querySelector('.clip-trim-l')).toBeTruthy();
    expect(clip.querySelector('.clip-trim-r')).toBeTruthy();
  });
  it('dragging the right trim handle shortens len via onTrimClip', () => {
    const el = document.createElement('div');
    const trims = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, off, +len.toFixed(2), x]) });
    const h = el.querySelector('.track-clip .clip-trim-r');
    // duration 2 (len 2, width 64px @ 32px/s); drag right edge from 64→32 = −1s → len 1, x unchanged
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 64, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 32, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 32, clientY: 0, bubbles: true }));
    expect(trims).toEqual([[1, 1, 0, 1, 10]]);
  });
  it('dragging the left trim handle moves offset + x', () => {
    const el = document.createElement('div');
    const trims = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, +off.toFixed(2), +len.toFixed(2), x]) });
    const h = el.querySelector('.track-clip .clip-trim-l');
    // drag left edge right by +1s → offset 1, len 1, x = 10 + 32 = 42
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 32, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 32, clientY: 0, bubbles: true }));
    expect(trims).toEqual([[1, 1, 1, 1, 42]]);
  });

  // The clip's 1px border pixel sits outside the trim handles (overflow:hidden
  // clips them to the padding box), so grabs within ~8px of an edge on the clip
  // BODY must route to trim, not start a move. jsdom rects are 0×0, so mock them.
  const mockRect = (clip) => { clip.getBoundingClientRect = () => ({ left: 10, right: 74, top: 0, bottom: 80, width: 64, height: 80 }); };
  it('grabbing the clip body at the left edge starts a trim, not a move', () => {
    const el = document.createElement('div');
    const trims = [], moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1,
      onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, +off.toFixed(2), +len.toFixed(2), x]),
      onMoveClips: (m) => moves.push(m), onMoveClip: (...a) => moves.push(a) });
    const clip = el.querySelector('.track-clip');
    mockRect(clip);
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 11, clientY: 40, bubbles: true })); // 1px inside the edge
    expect(clip.classList.contains('trimming')).toBe(true); // trim drag engaged
    const h = clip.querySelector('.clip-trim-l');
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 43, clientY: 40, bubbles: true })); // +32px = +1s
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 43, clientY: 40, bubbles: true }));
    expect(trims).toEqual([[1, 1, 1, 1, 42]]);
    expect(moves).toEqual([]);
    clearClipSelection();
  });
  it('grabbing the clip body at the right edge starts a trim, not a move', () => {
    const el = document.createElement('div');
    const trims = [], moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1,
      onTrimClip: (tid, n, off, len, x) => trims.push([tid, n, off, +len.toFixed(2), x]),
      onMoveClips: (m) => moves.push(m) });
    const clip = el.querySelector('.track-clip');
    mockRect(clip);
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 73, clientY: 40, bubbles: true })); // 1px inside the right edge
    expect(clip.classList.contains('trimming')).toBe(true);
    const h = clip.querySelector('.clip-trim-r');
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 41, clientY: 40, bubbles: true })); // −32px = −1s
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 41, clientY: 40, bubbles: true }));
    expect(trims).toEqual([[1, 1, 0, 1, 10]]);
    expect(moves).toEqual([]);
    clearClipSelection();
  });
  it('grabbing the clip body away from the edges still moves it', () => {
    const el = document.createElement('div');
    const trims = [], moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1,
      onTrimClip: (...a) => trims.push(a), onMoveClips: (m) => moves.push(m) });
    const clip = el.querySelector('.track-clip');
    mockRect(clip);
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 40, clientY: 0, bubbles: true })); // middle of the clip
    expect(clip.classList.contains('trimming')).toBe(false);
    clip.dispatchEvent(new MouseEvent('pointermove', { clientX: 72, clientY: 0, bubbles: true }));
    clip.dispatchEvent(new MouseEvent('pointerup', { clientX: 72, clientY: 0, bubbles: true }));
    expect(moves).toEqual([[{ trackId: 1, n: 1, x: 42 }]]); // 10 + 32
    expect(trims).toEqual([]);
    clearClipSelection();
  });

  // ── Loop-drag (GarageBand): the top of the right edge repeats the clip ──
  const looped = (rep) => [{ id: 1, name: 'A', armed: true, takes: [
    { n: 1, name: 'A', x: 0, duration: 2, len: 2, offset: 0, repeat: rep, samples: new Float32Array(4) },
  ] }];

  it('loopRepeatFromDrag: follows the pointer, snaps to whole reps, collapses < 1.05', () => {
    expect(loopRepeatFromDrag(1, 2, 96)).toBeCloseTo(2.5);  // 64px window +96px → 2.5, far from a boundary
    expect(loopRepeatFromDrag(1, 2, 60)).toBe(2);           // 1.9375 → 4px from the 2× boundary → snaps
    expect(loopRepeatFromDrag(1, 2, 68)).toBe(2);           // just past the boundary snaps back too
    expect(loopRepeatFromDrag(2.5, 2, -96)).toBe(1);        // dragged back to ~1 → loop removed
    expect(loopRepeatFromDrag(1, 2, 2)).toBe(1);            // barely out from 1 → snap back to 1
    expect(loopRepeatFromDrag(1, 2, -50)).toBe(1);          // can't go below one repetition
    expect(loopRepeatFromDrag(1, 0, 50)).toBe(1);           // zero-length window → inert
  });
  it('clips have a loop handle; a looped clip spans len*repeat with boundary notches', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: looped(2.5), armedId: 1 });
    const clip = el.querySelector('.track-clip');
    expect(clip.querySelector('.clip-loop')).toBeTruthy();
    expect(clip.style.width).toBe(`${2 * 2.5 * PX_PER_SEC}px`); // 160px: window × repeat
    expect(clip.querySelector('canvas.clip-wave').width).toBe(160);
    const notches = [...clip.querySelectorAll('.clip-loop-notch')];
    expect(notches.map((n) => n.style.left)).toEqual(['64px', '128px']); // each repetition edge
  });
  it('an unlooped clip renders no notches', () => {
    const el = document.createElement('div');
    renderTrackLane(el, { tracks: tracks(), armedId: 1 });
    expect(el.querySelectorAll('.clip-loop-notch')).toHaveLength(0);
  });
  it('dragging the loop handle commits the snapped repeat via onLoopClip', () => {
    const el = document.createElement('div');
    const loops = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onLoopClip: (tid, n, rep) => loops.push([tid, n, rep]) });
    const h = el.querySelector('.track-clip .clip-loop');
    // duration 2 → 64px window; +96px = 2.5 windows (no snap at 32px from a boundary)
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 64, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 160, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 160, clientY: 0, bubbles: true }));
    expect(loops).toEqual([[1, 1, 2.5]]);
  });
  it('loop drag live-previews the width and snaps near a whole repetition', () => {
    const el = document.createElement('div');
    const loops = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1, onLoopClip: (tid, n, rep) => loops.push([tid, n, rep]) });
    const clip = el.querySelector('.track-clip');
    const h = clip.querySelector('.clip-loop');
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 64, clientY: 0, bubbles: true }));
    expect(clip.classList.contains('looping')).toBe(true);
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 124, clientY: 0, bubbles: true })); // +60px → 1.9375 → snaps to 2
    expect(clip.style.width).toBe('128px');                    // preview follows the snap
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 124, clientY: 0, bubbles: true }));
    expect(clip.classList.contains('looping')).toBe(false);
    expect(loops).toEqual([[1, 1, 2]]);
  });
  it('dragging a looped clip back under ~1.05 windows removes the loop', () => {
    const el = document.createElement('div');
    const loops = [];
    renderTrackLane(el, { tracks: looped(2.5), armedId: 1, onLoopClip: (tid, n, rep) => loops.push([tid, n, rep]) });
    const h = el.querySelector('.track-clip .clip-loop');
    h.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 160, clientY: 0, bubbles: true }));
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 62, clientY: 0, bubbles: true })); // span → ~62px ≈ 0.97 windows
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 62, clientY: 0, bubbles: true }));
    expect(loops).toEqual([[1, 1, 1]]);
  });
  it('grabbing the clip body at the TOP of the right edge starts a loop drag, not a trim', () => {
    const el = document.createElement('div');
    const loops = [], trims = [], moves = [];
    renderTrackLane(el, { tracks: tracks(), armedId: 1,
      onLoopClip: (tid, n, rep) => loops.push([tid, n, rep]),
      onTrimClip: (...a) => trims.push(a), onMoveClips: (m) => moves.push(m) });
    const clip = el.querySelector('.track-clip');
    mockRect(clip);
    // right edge (73 ≥ 74−8), upper 40% of the 80px clip (y 10 < 32) → loop
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 73, clientY: 10, bubbles: true }));
    expect(clip.classList.contains('looping')).toBe(true);
    expect(clip.classList.contains('trimming')).toBe(false);
    const h = clip.querySelector('.clip-loop');
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 169, clientY: 10, bubbles: true })); // +96px → 2.5
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 169, clientY: 10, bubbles: true }));
    expect(loops).toEqual([[1, 1, 2.5]]);
    expect(trims).toEqual([]); expect(moves).toEqual([]);
    clearClipSelection();
  });
  it('the right edge of a LOOPED clip below the loop zone resizes the span, not the window', () => {
    const el = document.createElement('div');
    const loops = [], trims = [];
    renderTrackLane(el, { tracks: looped(2), armedId: 1,
      onLoopClip: (tid, n, rep) => loops.push([tid, n, rep]), onTrimClip: (...a) => trims.push(a) });
    const clip = el.querySelector('.track-clip');
    clip.getBoundingClientRect = () => ({ left: 0, right: 128, top: 0, bottom: 80, width: 128, height: 80 });
    // bottom 60% of the right edge → routed to trim, which span-resizes a looped clip
    clip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 127, clientY: 60, bubbles: true }));
    expect(clip.classList.contains('trimming')).toBe(true);
    const h = clip.querySelector('.clip-trim-r');
    h.dispatchEvent(new MouseEvent('pointermove', { clientX: 159, clientY: 60, bubbles: true })); // +32px = +1s → 2.5 windows
    expect(clip.style.width).toBe('160px');
    h.dispatchEvent(new MouseEvent('pointerup', { clientX: 159, clientY: 60, bubbles: true }));
    expect(loops).toEqual([[1, 1, 2.5]]);
    expect(trims).toEqual([]); // the base window is never touched under a loop
    clearClipSelection();
  });
});
