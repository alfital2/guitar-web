import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  LICK_VERSION, AUTOSAVE_KEY,
  encodeLick, decodeLick, downloadLick, readLickFile,
  autosaveTab, loadAutosave, toAscii,
} from '../src/tab/tab-file.js';

// A representative v2 state: chord (two notes on one tick), technique flags,
// det provenance — everything that must survive the binary round-trip.
const state = () => ({
  version: 2, tempo: 132, timeSig: { num: 3, den: 4 }, tuning: 'DropD', capo: 2,
  notes: [
    { id: 1, tick: 0,  durTicks: 12, string: 3, fret: 5,  tech: {},             det: { midi: 55, string: 3, fret: 5, tSec: 0.01, durSec: 0.31 } },
    { id: 2, tick: 0,  durTicks: 12, string: 4, fret: 7,  tech: { pm: true },   det: null },
    { id: 3, tick: 12, durTicks: 6,  string: 0, fret: 12, tech: { bend: 0.5 },  det: null },
  ],
});

beforeEach(() => localStorage.clear());

describe('.lick codec', () => {
  it('encodes magic GWL1 + version byte + a compressed body', async () => {
    const bytes = await encodeLick(state());
    expect([...bytes.subarray(0, 4)]).toEqual([0x47, 0x57, 0x4c, 0x31]);   // 'G' 'W' 'L' '1'
    expect(bytes[4]).toBe(LICK_VERSION);
    expect(bytes.length).toBeGreaterThan(5);
  });

  it('round-trips encode → decode', async () => {
    const s = state();
    expect(await decodeLick(await encodeLick(s))).toEqual(s);
  });

  it('actually compresses a repetitive tab', async () => {
    const s = state();
    for (let i = 0; i < 200; i++) s.notes.push({ id: 10 + i, tick: i * 3, durTicks: 3, string: 3, fret: 5, tech: {}, det: null });
    const bytes = await encodeLick(s);
    expect(bytes.length).toBeLessThan(JSON.stringify(s).length / 4);
  });

  it("rejects bad magic with 'Not a .lick file'", async () => {
    await expect(decodeLick(new Uint8Array([1, 2, 3, 4, 5, 6]))).rejects.toThrow('Not a .lick file');
    const wav = new TextEncoder().encode('RIFF....WAVE');                  // a real-ish other format
    await expect(decodeLick(wav)).rejects.toThrow('Not a .lick file');
  });

  it('rejects truncated input (shorter than the header)', async () => {
    await expect(decodeLick(new Uint8Array([0x47, 0x57, 0x4c]))).rejects.toThrow('Not a .lick file');
    await expect(decodeLick(new Uint8Array())).rejects.toThrow('Not a .lick file');
  });

  it("rejects a future format version with 'Unsupported .lick version'", async () => {
    const bytes = await encodeLick(state());
    bytes[4] = LICK_VERSION + 1;
    await expect(decodeLick(bytes)).rejects.toThrow('Unsupported .lick version');
  });

  it('rejects a corrupted body (valid header, garbage deflate)', async () => {
    const bytes = new Uint8Array([0x47, 0x57, 0x4c, 0x31, LICK_VERSION, 0xff, 0xff, 0xff, 0xff]);
    await expect(decodeLick(bytes)).rejects.toThrow();
  });

  it('readLickFile decodes a File (jsdom FileReader path — no Blob.arrayBuffer)', async () => {
    const s = state();
    const file = new File([await encodeLick(s)], 'riff.lick');
    expect(await readLickFile(file)).toEqual(s);
  });

  it('downloadLick clicks an anchor named <name>.lick', async () => {
    // jsdom has no URL.createObjectURL — stub the pair for the test
    URL.createObjectURL = vi.fn(() => 'blob:lick');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadLick(state(), 'my-riff');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0].download).toBe('my-riff.lick');
    click.mockRestore();
  });
});

describe('localStorage autosave', () => {
  it('round-trips under the stable key', () => {
    const s = state();
    autosaveTab(s);
    expect(JSON.parse(localStorage.getItem(AUTOSAVE_KEY))).toEqual(s);
    expect(loadAutosave()).toEqual(s);
  });

  it('returns null when empty or corrupt (never throws)', () => {
    expect(loadAutosave()).toBeNull();
    localStorage.setItem(AUTOSAVE_KEY, '{not json');
    expect(loadAutosave()).toBeNull();
  });
});

describe('toAscii', () => {
  it('renders the classic 6-line tab: bars, wide frets, technique glyphs, dead x', () => {
    const s = {
      version: 2, tempo: 120, timeSig: { num: 4, den: 4 }, tuning: 'EADGBE', capo: 0,
      notes: [
        { id: 1, tick: 0,  durTicks: 12, string: 3, fret: 5,  tech: {},             det: null },
        { id: 2, tick: 6,  durTicks: 6,  string: 3, fret: 7,  tech: { hp: 'h' },    det: null },
        { id: 3, tick: 12, durTicks: 3,  string: 0, fret: 10, tech: {},             det: null },
        { id: 4, tick: 12, durTicks: 3,  string: 5, fret: 0,  tech: { dead: true }, det: null },
        { id: 5, tick: 48, durTicks: 12, string: 2, fret: 9,  tech: { slide: '/' }, det: null },
      ],
    };
    expect(toAscii(s)).toBe([
      'e|---------10-----------------------|---------------------------------|',
      'B|----------------------------------|---------------------------------|',
      'G|----------------------------------|9/-------------------------------|',
      'D|5---7h----------------------------|---------------------------------|',
      'A|----------------------------------|---------------------------------|',
      'E|---------x------------------------|---------------------------------|',
    ].join('\n'));
  });

  it('empty tab prints one bar sized by the time signature, gutter follows tuning', () => {
    expect(toAscii({ version: 2, tempo: 90, timeSig: { num: 3, den: 4 }, tuning: 'DropD', capo: 0, notes: [] })).toBe([
      'e|------------------------|',
      'B|------------------------|',
      'G|------------------------|',
      'D|------------------------|',
      'A|------------------------|',
      'D|------------------------|',
    ].join('\n'));
  });

  it('two-char tuning names align the gutter', () => {
    const out = toAscii({
      version: 2, tempo: 120, timeSig: { num: 4, den: 4 }, tuning: 'Eb', capo: 0,
      notes: [{ id: 1, tick: 0, durTicks: 3, string: 1, fret: 3, tech: {}, det: null }],
    });
    const lines = out.split('\n');
    expect(lines[0].startsWith('eb|')).toBe(true);
    expect(lines[1].startsWith('Bb|3-')).toBe(true);
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);   // all rows equal width
  });
});
