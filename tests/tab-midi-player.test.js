// tests/tab-midi-player.test.js — the tab's MIDI player on the fake audio
// clock. The lookahead scheduler bridges two clocks (audio time + JS timers),
// so every test advances both together in 25ms slices: the 50ms scheduler
// interval and the faked rAF each fire within an advance() call.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTabMidiPlayer, clampSpeed, beatSeconds, barSeconds, loopWindow } from '../src/tab/tab-midi-player.js';
import { FakeAudioContext } from './fake-audio-context.js';

// FakeAudioContext has no currentTime and its osc.start(t) drops the arg —
// give it a clock and record every start's time/freq/type without touching
// the shared fake.
function makeCtx() {
  const fc = new FakeAudioContext();
  fc.currentTime = 0;
  const starts = [];
  const orig = fc.createOscillator.bind(fc);
  fc.createOscillator = () => {
    const o = orig();
    const s = o.start.bind(o), p = o.stop.bind(o);
    o.start = (t) => { starts.push({ t, freq: o.frequency.value, type: o.type }); s(); };
    o.stop = (t) => { o.stoppedAt = t; p(); };
    return o;
  };
  return { fc, starts };
}
// Advance the audio clock and the JS timers together.
const advance = (fc, ms) => {
  for (let i = 0; i < ms / 25; i++) { fc.currentTime += 0.025; vi.advanceTimersByTime(25); }
};
const notesOf = (starts) => starts.filter((s) => s.type === 'triangle'); // note voices
const clicksOf = (starts) => starts.filter((s) => s.type === 'sine');    // metronome clicks

beforeEach(() => vi.useFakeTimers({
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'],
}));
afterEach(() => vi.useRealTimers());

describe('clampSpeed', () => {
  it('clamps to the 50–100% practice range', () => {
    expect(clampSpeed(0.25)).toBe(0.5);
    expect(clampSpeed(2)).toBe(1);
    expect(clampSpeed(0.75)).toBe(0.75);
    expect(clampSpeed(undefined)).toBe(1);
    expect(clampSpeed(NaN)).toBe(1);
  });
});

describe('lookahead scheduling', () => {
  it('schedules only the lookahead window, not the whole tab', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    const notes = [
      { tSec: 0, durSec: 0.3, midi: 55 },
      { tSec: 1, durSec: 0.3, midi: 57 },
      { tSec: 2, durSec: 0.3, midi: 59 },
    ];
    expect(p.play(notes, {})).toBe(true);
    expect(notesOf(starts).length).toBe(1);          // only t=0 sits inside the 200ms horizon
    advance(fc, 1000);
    expect(notesOf(starts).length).toBe(2);          // t=1 picked up as the clock approached it
    advance(fc, 1000);
    expect(notesOf(starts).length).toBe(3);
    expect(notesOf(starts).map((s) => s.t.toFixed(2))).toEqual(['0.06', '1.06', '2.06']);
    p.stop();
  });

  it('speed 0.5 scales ALL times: t/speed', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55 }, { tSec: 1, durSec: 0.3, midi: 57 }], { speed: 0.5 });
    advance(fc, 2000);
    const n = notesOf(starts);
    expect(n.length).toBe(2);
    expect(n[0].t).toBeCloseTo(0.06, 5);
    expect(n[1].t).toBeCloseTo(2.06, 5);             // 0.06 + 1/0.5
    p.stop();
  });

  it('onTick reports tab-time seconds (audio elapsed × speed)', () => {
    const { fc } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    let last = -1;
    p.play(
      [{ tSec: 0, durSec: 0.3, midi: 55 }, { tSec: 4, durSec: 0.3, midi: 57 }],
      { speed: 0.5, onTick: (t) => { last = t; } },
    );
    advance(fc, 2000);                               // 2s of audio → ~1s of tab time
    expect(last).toBeGreaterThan(0.9);
    expect(last).toBeLessThan(1.01);
    p.stop();
  });

  it('ends after the last note: onEnd fires, isPlaying false', () => {
    const { fc } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    let ended = false;
    p.play([{ tSec: 0, durSec: 0.3, midi: 55 }], { onEnd: () => { ended = true; } });
    expect(p.isPlaying()).toBe(true);
    advance(fc, 700);                                // past 0.06 + 0.3 + 0.12 tail
    expect(ended).toBe(true);
    expect(p.isPlaying()).toBe(false);
  });

  it('stop() halts the scheduler — later notes are never scheduled', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55 }, { tSec: 3, durSec: 0.3, midi: 57 }], {});
    advance(fc, 300);
    expect(notesOf(starts).length).toBe(1);
    p.stop();
    expect(p.isPlaying()).toBe(false);
    advance(fc, 4000);
    expect(notesOf(starts).length).toBe(1);          // t=3 never fires after stop
  });

  it('returns false and fires onEnd for an empty tab', () => {
    const { fc } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    let ended = false;
    expect(p.play([], { onEnd: () => { ended = true; } })).toBe(false);
    expect(ended).toBe(true);
  });
});

describe('bar/beat helpers', () => {
  it('den-appropriate beat unit', () => {
    expect(beatSeconds(120, 4)).toBeCloseTo(0.5);
    expect(beatSeconds(120, 8)).toBeCloseTo(0.25);
    expect(barSeconds(120, { num: 3, den: 4 })).toBeCloseTo(1.5);
    expect(barSeconds(120, { num: 6, den: 8 })).toBeCloseTo(1.5);
  });
});

describe('metronome + count-in', () => {
  it('one-bar count-in precedes the notes, accent on beat 1', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55 }], { countIn: true, tempo: 120, timeSig: { num: 4, den: 4 } });
    advance(fc, 2500);
    const clicks = clicksOf(starts);
    expect(clicks.map((c) => c.t.toFixed(2))).toEqual(['0.06', '0.56', '1.06', '1.56']);
    expect(clicks.map((c) => c.freq)).toEqual([1000, 800, 800, 800]);   // accent, then plain
    expect(notesOf(starts)[0].t).toBeCloseTo(2.06, 5);                  // note pushed one bar
  });

  it('metronome clicks throughout, TS-aware accents (3/4)', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play(
      [{ tSec: 0, durSec: 0.3, midi: 55 }, { tSec: 2.5, durSec: 0.4, midi: 57 }],
      { metronome: true, tempo: 120, timeSig: { num: 3, den: 4 } },
    );
    advance(fc, 3000);
    const clicks = clicksOf(starts);
    expect(clicks.length).toBe(6);                                      // 0, .5 … 2.5 (< 2.9 last-note-off)
    expect(clicks.map((c) => c.freq)).toEqual([1000, 800, 800, 1000, 800, 800]);
    p.stop();
  });

  it('6/8: beat unit is the eighth, accent every 6 beats', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play(
      [{ tSec: 0, durSec: 0.3, midi: 55 }, { tSec: 2.7, durSec: 0.3, midi: 57 }],
      { metronome: true, tempo: 120, timeSig: { num: 6, den: 8 } },
    );
    advance(fc, 3200);
    const clicks = clicksOf(starts);
    expect(clicks.length).toBe(12);                                     // every 0.25s across 3.0s
    expect(clicks.filter((c) => c.freq === 1000).map((c) => c.t.toFixed(2))).toEqual(['0.06', '1.56']);
  });

  it('count-in and clicks scale with speed', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55 }], { countIn: true, speed: 0.5, tempo: 120, timeSig: { num: 4, den: 4 } });
    advance(fc, 4500);
    expect(clicksOf(starts).map((c) => c.t.toFixed(2))).toEqual(['0.06', '1.06', '2.06', '3.06']);
    expect(notesOf(starts)[0].t).toBeCloseTo(4.06, 5);
    p.stop();
  });

  it('onTick holds at 0 during the count-in, then rides tab time', () => {
    const { fc } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    const seen = [];
    p.play(
      [{ tSec: 0, durSec: 0.3, midi: 55 }],
      { countIn: true, tempo: 120, timeSig: { num: 4, den: 4 }, onTick: (t) => seen.push(t) },
    );
    advance(fc, 1900);                          // still inside the 2s count-in bar
    expect(Math.max(...seen)).toBe(0);
    advance(fc, 400);
    expect(Math.max(...seen)).toBeGreaterThan(0.2);
    p.stop();
  });
});

describe('loop', () => {
  it('repeats the region seamlessly on the audio clock, excluding outside notes', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([
      { tSec: 0.2, durSec: 0.2, midi: 50 },              // outside the loop — never plays
      { tSec: 1.0, durSec: 0.2, midi: 55 },
      { tSec: 1.5, durSec: 0.2, midi: 57 },
    ], { loop: { startSec: 1, endSec: 2 }, tempo: 120 });
    advance(fc, 2100);
    const n = notesOf(starts);
    // exact 1.0s period, zero seam: 0.06, +0.5, +1.0, +1.5, +2.0
    expect(n.map((s) => s.t.toFixed(2))).toEqual(['0.06', '0.56', '1.06', '1.56', '2.06']);
    expect(n.some((s) => s.freq < 190)).toBe(false);     // midi 50 (≈147Hz) excluded
    p.stop();
  });

  it('onTick stays within [startSec, endSec) and the loop never self-ends', () => {
    const { fc } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    const seen = [];
    p.play([{ tSec: 1.0, durSec: 0.2, midi: 55 }], { loop: { startSec: 1, endSec: 2 }, onTick: (t) => seen.push(t) });
    advance(fc, 3500);
    expect(p.isPlaying()).toBe(true);                    // 3.5s > region — still going
    expect(seen.every((t) => t >= 1 && t < 2)).toBe(true);
    expect(Math.max(...seen)).toBeGreaterThan(1.4);      // it actually rides the bar
    p.stop();
    expect(p.isPlaying()).toBe(false);
  });

  it('metronome clicks keep the absolute beat grid inside the loop', () => {
    const { fc, starts } = makeCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 2.0, durSec: 0.2, midi: 55 }],
      { loop: { startSec: 2, endSec: 4 }, metronome: true, tempo: 120, timeSig: { num: 4, den: 4 } });
    advance(fc, 2100);
    const clicks = clicksOf(starts);
    expect(clicks.map((c) => c.t.toFixed(2))).toEqual(['0.06', '0.56', '1.06', '1.56', '2.06']);
    // beats 4..7 of the tab: accent only on beat 4 (bar 2's downbeat) — and
    // again the instant the loop wraps
    expect(clicks.map((c) => c.freq)).toEqual([1000, 800, 800, 800, 1000]);
    p.stop();
  });
});

describe('loopWindow', () => {
  const state = {
    tempo: 120, timeSig: { num: 4, den: 4 },
    notes: [{ tick: 0, durTicks: 12 }, { tick: 60, durTicks: 12 }],   // spills into bar 2
  };
  it('no selection → whole tab, rounded up to full bars', () => {
    expect(loopWindow(state, null)).toEqual({ startSec: 0, endSec: 4 });
  });
  it('selection expands to whole bars', () => {
    expect(loopWindow(state, { startTick: 50, endTick: 60 })).toEqual({ startSec: 2, endSec: 4 });
  });
  it('empty tab still yields one bar', () => {
    expect(loopWindow({ tempo: 120, timeSig: { num: 4, den: 4 }, notes: [] }, null)).toEqual({ startSec: 0, endSec: 2 });
  });
  it('tempo drives the seconds', () => {
    expect(loopWindow({ ...state, tempo: 60 }, null)).toEqual({ startSec: 0, endSec: 8 });
  });
});

// Techniques need observable AudioParam automation; the base fake's params
// are plain { value } holders. This wrapper upgrades oscillator frequency to
// a recording param and logs every gain's exponential ramps, so freq glides
// and attack/decay envelopes can be asserted.
function makeTechCtx() {
  const { fc, starts } = makeCtx();
  const freqEvents = [];
  const gainRamps = [];
  const wrapOsc = fc.createOscillator;               // makeCtx's wrapper (records starts)
  fc.createOscillator = () => {
    const o = wrapOsc();
    const f = o.frequency;                           // plain { value } on the fake
    o.frequency = {
      get value() { return f.value; },
      set value(v) { f.value = v; },
      setValueAtTime(v, t) { f.value = v; freqEvents.push({ kind: 'set', v, t }); },
      linearRampToValueAtTime(v, t) { freqEvents.push({ kind: 'ramp', v, t }); },
    };
    return o;
  };
  const mkGain = fc.createGain.bind(fc);
  fc.createGain = () => {
    const g = mkGain();
    const ramp = g.gain.exponentialRampToValueAtTime.bind(g.gain);
    g.gain.exponentialRampToValueAtTime = (v, t) => { gainRamps.push({ v, t }); ramp(v, t); };
    return g;
  };
  return { fc, starts, freqEvents, gainRamps };
}

describe('technique voices', () => {
  it('slide glides to the NEXT note on the same string across the note', () => {
    const { fc, freqEvents } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([
      { tSec: 0, durSec: 0.3, midi: 55, string: 2, tech: { slide: '/' } },
      { tSec: 0.3, durSec: 0.3, midi: 60, string: 2, tech: {} },
    ], {});
    expect(freqEvents).toHaveLength(2);
    expect(freqEvents[0].kind).toBe('set');
    expect(freqEvents[0].v).toBeCloseTo(196.0, 1);       // G3 — the written note
    expect(freqEvents[0].t).toBeCloseTo(0.06, 5);
    expect(freqEvents[1].kind).toBe('ramp');
    expect(freqEvents[1].v).toBeCloseTo(261.63, 1);      // C4 — the destination note
    expect(freqEvents[1].t).toBeCloseTo(0.36, 5);        // arrives as the next note starts
    p.stop();
  });

  it('a phrase-ending slide falls back to ±2 semitones in the marked direction', () => {
    const { fc, freqEvents } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55, string: 2, tech: { slide: '\\' } }], {});
    expect(freqEvents[1].v).toBeCloseTo(174.61, 1);      // F3 — two semitones down
    p.stop();
  });

  it('bend ramps up ½ or 1 tone within the first half of the note', () => {
    const { fc, freqEvents } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.4, midi: 55, tech: { bend: 0.5 } }], {});
    expect(freqEvents[1].v).toBeCloseTo(207.65, 1);      // +1 semitone (½ tone)
    expect(freqEvents[1].t).toBeCloseTo(0.26, 5);        // 0.06 + min(dur/2, 0.25)
    p.stop();
    freqEvents.length = 0;
    p.play([{ tSec: 0, durSec: 0.4, midi: 55, tech: { bend: 1 } }], {});
    expect(freqEvents[1].v).toBeCloseTo(220, 1);         // +2 semitones (full tone)
    p.stop();
  });

  it('hp softens the attack: slower, quieter swell instead of a pluck', () => {
    const { fc, gainRamps } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55, tech: { hp: 'h' } }], {});
    expect(gainRamps[0].v).toBe(0.55);                   // vs 0.9 pluck
    expect(gainRamps[0].t).toBeCloseTo(0.09, 5);         // 30ms swell vs 6ms pick
    expect(gainRamps[1]).toMatchObject({ v: 0.0001 });   // normal decay
    p.stop();
  });

  it('pm darkens the lowpass and cuts the decay short', () => {
    const { fc, gainRamps } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.4, midi: 57, tech: { pm: true } }], {});
    const lp = fc.nodesByKind.biquad.find((b) => b.type === 'lowpass');
    expect(lp.frequency.value).toBeCloseTo(660, 5);      // min(1400, 3·220) vs 1320 open
    expect(gainRamps[0].v).toBe(0.7);
    expect(gainRamps[1].t).toBeCloseTo(0.24, 5);         // 0.06 + 0.4·0.45 — vs 0.46 open
    p.stop();
  });

  it('dead notes make a noise tick, not a tone', () => {
    const { fc, starts } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55, tech: { dead: true } }], {});
    expect(notesOf(starts)).toHaveLength(0);             // no oscillator voice at all
    expect(fc.srcStarts).toBe(1);                        // one noise burst
    const bp = fc.nodesByKind.biquad.find((b) => b.type === 'bandpass');
    expect(bp.frequency.value).toBe(3000);
    expect(fc.nodesByKind.buffersource[0].buffer.length).toBe(2880);  // 60ms @ 48k
    p.stop();
  });

  it('plain notes are untouched: pluck attack, open lowpass, no freq automation', () => {
    const { fc, freqEvents, gainRamps } = makeTechCtx();
    const p = createTabMidiPlayer({ getContext: () => fc });
    p.play([{ tSec: 0, durSec: 0.3, midi: 55, tech: {} }], {});
    expect(freqEvents).toHaveLength(0);
    expect(gainRamps[0]).toMatchObject({ v: 0.9 });
    expect(fc.nodesByKind.biquad[0].frequency.value).toBeCloseTo(1176, 0);  // 6·196
    p.stop();
  });
});
