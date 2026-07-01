// tests/metronome-teardown.test.js — finding #7: stop() must clear the pending
// setTimeouts (beat-UI callbacks, armed count-in downbeat) and stop the click
// oscillators already scheduled ahead by the lookahead scheduler.
//
// metronome.js captures `AC = AudioContext` at module load, so this file
// installs a fake global BEFORE dynamic-importing the module. It lives apart
// from metronome.test.js, whose static import must keep seeing no AudioContext
// (vitest gives each test file its own module registry, so both coexist).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { FakeAudioContext } from './fake-audio-context.js';

let lastCtx = null;
class FakeCtx extends FakeAudioContext {
  constructor() { super(); this.currentTime = 0; this.state = 'running'; lastCtx = this; }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

let createMetronome;
beforeAll(async () => {
  globalThis.AudioContext = FakeCtx;
  ({ createMetronome } = await import('../src/metronome.js'));
});

beforeEach(() => { vi.useFakeTimers(); lastCtx = null; });
afterEach(() => { vi.useRealTimers(); });

describe('metronome stop() teardown', () => {
  it('clears the scheduler interval + pending beat timeouts and stops scheduled clicks', () => {
    const beats = [];
    const m = createMetronome({ onBeat: (b) => beats.push(b) });
    m.start();
    const ctx = lastCtx;
    vi.advanceTimersByTime(25);                 // one scheduler tick
    expect(ctx.oscStarts).toBe(1);              // first click scheduled ahead
    expect(vi.getTimerCount()).toBeGreaterThan(1); // interval + pending onBeat timeout

    m.stop();
    expect(vi.getTimerCount()).toBe(0);         // interval AND timeouts all cancelled
    // click() itself schedules osc.stop(t+0.06) (1st stop call); teardown then
    // re-stops it immediately (2nd) so the ahead-scheduled click never sounds.
    expect(ctx.oscStops).toBe(2);

    vi.advanceTimersByTime(5000);
    expect(beats).toEqual([]);                  // pending onBeat never fired
    expect(ctx.oscStarts).toBe(1);              // no further clicks were scheduled
  });

  it('stop() during a count-in cancels the armed downbeat — recording never starts', () => {
    const m = createMetronome();
    const down = vi.fn();
    m.armRecord({ countBeats: 1, recordMetro: true, onDownbeat: down });
    // Put the audio clock where the scheduler arms the downbeat with a small
    // positive REC_LEAD delay (beat 1 lands at 0.12 + 0.5 = 0.62s):
    lastCtx.currentTime = 0.525;
    vi.advanceTimersByTime(25);                 // scheduler ticks; downbeat timeout armed
    expect(down).not.toHaveBeenCalled();        // ...but not yet fired (REC_LEAD)

    m.stop();                                   // user stops during the lead window
    vi.runAllTimers();
    expect(down).not.toHaveBeenCalled();        // the downbeat was cancelled
    expect(vi.getTimerCount()).toBe(0);
  });

  it('count-in only: the grid halts itself at the downbeat but the armed downbeat still fires', () => {
    const m = createMetronome();
    const down = vi.fn();
    m.armRecord({ countBeats: 1, recordMetro: false, onDownbeat: down });
    lastCtx.currentTime = 0.525;
    vi.advanceTimersByTime(25);
    expect(m.isRunning()).toBe(false);          // internal halt (count-in only, no clicks while recording)
    expect(down).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);                 // let the REC_LEAD timeout land
    expect(down).toHaveBeenCalledTimes(1);      // recording start survives the internal halt
  });
});
