import { describe, it, expect, beforeEach } from 'vitest';
import { mountTabLane } from '../src/tab/tab-lane.js';
import { midiForPosition } from '../src/tab/transcribe.js';

let container;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); });

// string indices: 0 e, 1 B, 2 G, 3 D, 4 A, 5 E
const add = (lane, string, fret, col = 4) =>
  lane.noteOn(string, fret, col, { midi: midiForPosition(string, fret), tSec: col / 8, durSec: 0.3 });

describe('tab-lane editor model', () => {
  it('stores a detected note with pitch + detected snapshot', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    add(lane, 3, 5);                                   // fret 5 on D = midi 55
    const [n] = lane.getNotes();
    expect(n).toMatchObject({ string: 3, fret: 5, midi: 55, detMidi: 55, detString: 3, detFret: 5, edited: false });
  });

  it("drag D-string fret 5 → G string becomes fret 0, pitch preserved (the ask)", () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const id = add(lane, 3, 5);
    expect(lane.moveNoteToString(id, 2)).toBe(true);   // to G string
    const [n] = lane.getNotes();
    expect(n.string).toBe(2);
    expect(n.fret).toBe(0);
    expect(n.midi).toBe(55);                           // SOUND unchanged
    expect(n.edited).toBe(true);
    expect(n.detString).toBe(3);                       // remembers the detection
    expect(n.detFret).toBe(5);
  });

  it('rejects a drag when the pitch cannot sit on the target string', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const id = add(lane, 5, 0);                         // open low E = midi 40
    expect(lane.moveNoteToString(id, 0)).toBe(false);  // high e open is 64 — impossible
    const [n] = lane.getNotes();
    expect(n).toMatchObject({ string: 5, fret: 0, midi: 40, edited: false });
  });

  it('double-click edit (setNoteFret) CHANGES the pitch and marks edited', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const id = add(lane, 3, 5);                         // midi 55
    expect(lane.setNoteFret(id, 7)).toBe(true);
    const [n] = lane.getNotes();
    expect(n.fret).toBe(7);
    expect(n.midi).toBe(midiForPosition(3, 7));        // 57 — pitch corrected
    expect(n.edited).toBe(true);
    expect(n.detMidi).toBe(55);                        // original detection kept for training
  });

  it('rejects an out-of-range fret edit', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const id = add(lane, 3, 5);
    expect(lane.setNoteFret(id, 99)).toBe(false);
    expect(lane.setNoteFret(id, -1)).toBe(false);
    expect(lane.getNotes()[0].fret).toBe(5);
  });

  it('onChange fires after every edit with the serialized model', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    let last = null, calls = 0;
    lane.onChange((m) => { last = m; calls++; });
    const id = add(lane, 3, 5);
    lane.moveNoteToString(id, 2);
    lane.setNoteFret(lane.getNotes()[0].id, 3);
    expect(calls).toBe(2);
    expect(last.notes[0].fret).toBe(3);
  });

  it('serialize → loadNotes round-trips, preserving detected vs corrected', () => {
    const lane = mountTabLane(container, { bpm: 90 });
    const id = add(lane, 3, 5, 8);
    lane.moveNoteToString(id, 2);                       // now G/0, detected D/5
    const model = lane.serialize();
    expect(model).toMatchObject({ bpm: 90, tuning: 'EADGBE' });

    const lane2 = mountTabLane(document.createElement('div'), { bpm: 90 });
    lane2.loadNotes(model);
    const [n] = lane2.getNotes();
    expect(n).toMatchObject({ string: 2, fret: 0, midi: 55, detString: 3, detFret: 5, edited: true, col: 8 });
  });

  it('clear empties the model', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    add(lane, 3, 5); add(lane, 4, 2);
    expect(lane.noteCount()).toBe(2);
    lane.clear();
    expect(lane.noteCount()).toBe(0);
    expect(lane.getNotes()).toEqual([]);
  });
});

describe('tab-lane playhead + note highlight', () => {
  it('setPlayhead shows the cursor and highlights the sounding note', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    // note at 0.5 s lasting 0.4 s
    lane.noteOn(3, 5, 4, { midi: 55, tSec: 0.5, durSec: 0.4 });
    const cursor = container.querySelector('.tab-cursor');
    const note = container.querySelector('.tab-note');

    lane.setPlayhead(0.6);                        // inside the note's window
    expect(cursor.style.opacity).toBe('1');
    expect(note.classList.contains('playing')).toBe(true);

    lane.setPlayhead(2.0);                        // well past it
    expect(note.classList.contains('playing')).toBe(false);
  });

  it('hidePlayhead hides the cursor and clears highlights', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    lane.noteOn(3, 5, 4, { midi: 55, tSec: 0.5, durSec: 0.4 });
    lane.setPlayhead(0.6);
    lane.hidePlayhead();
    const cursor = container.querySelector('.tab-cursor');
    expect(cursor.style.opacity).toBe('0');
    expect(container.querySelector('.tab-note').classList.contains('playing')).toBe(false);
  });

  it('cursor x tracks time on the 16th-column geometry', () => {
    const lane = mountTabLane(container, { bpm: 120 });   // 1 beat = 0.5 s = 4 cols = 104 px
    lane.noteOn(5, 0, 0, { midi: 40, tSec: 0, durSec: 0.2 });
    const cursor = container.querySelector('.tab-cursor');
    lane.setPlayhead(0.5);                          // one beat → colF 4 → x = 4*26 + 13
    expect(cursor.style.transform).toBe('translateX(117px)');
  });

  it('setPlaying toggles the strip play button glyph', () => {
    const lane = mountTabLane(container, { bpm: 120 });
    const btn = container.querySelector('.tab-play');
    expect(btn.textContent).toBe('▶');
    lane.setPlaying(true);
    expect(btn.textContent).toBe('⏸');
    expect(btn.classList.contains('on')).toBe(true);
    lane.setPlaying(false);
    expect(btn.textContent).toBe('▶');
  });
});
