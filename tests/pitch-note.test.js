// tests/pitch-note.test.js
import { describe, it, expect } from 'vitest';
import { freqToNote, noteLabel } from '../src/pitch/note.js';

describe('freqToNote', () => {
  it('A4 = 440 Hz', () => {
    const n = freqToNote(440);
    expect(n.name).toBe('A'); expect(n.octave).toBe(4); expect(Math.abs(n.cents)).toBeLessThanOrEqual(1);
  });
  it('C4 = 261.626 Hz', () => {
    const n = freqToNote(261.626);
    expect(n.name).toBe('C'); expect(n.octave).toBe(4);
  });
  it('low E2 = 82.41 Hz', () => {
    const n = freqToNote(82.41);
    expect(n.name).toBe('E'); expect(n.octave).toBe(2);
  });
  it('reports cents offset when slightly sharp', () => {
    const n = freqToNote(445);
    expect(n.name).toBe('A'); expect(n.cents).toBeGreaterThan(10);
  });
});

describe('noteLabel', () => {
  it('formats name+octave', () => {
    expect(noteLabel({ name: 'A', octave: 4 })).toBe('A4');
    expect(noteLabel({ name: 'C#', octave: 4 })).toBe('C#4');
  });
});
