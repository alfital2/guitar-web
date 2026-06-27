// tests/calibration-eq.test.js
import { describe, it, expect } from 'vitest';
import { createCalibrationEq } from '../src/calibration/calibration-eq.js';
import { BANDS } from '../src/calibration/bands.js';
import { FakeAudioContext } from './fake-audio-context.js';

describe('createCalibrationEq', () => {
  it('builds N peaking filters at the band centers, chained input->...->output', () => {
    const ctx = new FakeAudioContext();
    const eq = createCalibrationEq(ctx);
    expect(eq.filters).toHaveLength(BANDS.length);
    eq.filters.forEach((f, i) => { expect(f.type).toBe('peaking'); expect(f.frequency.value).toBe(BANDS[i]); });
    expect(eq.input.kind).toBe('gain');
    expect(eq.output.kind).toBe('gain');
    expect(ctx.connections.some(c => c.from === eq.input.id && c.to === eq.filters[0].id)).toBe(true);
    expect(ctx.connections.some(c => c.from === eq.filters[BANDS.length - 1].id && c.to === eq.output.id)).toBe(true);
  });
  it('apply sets filter gains; zeros are transparent', () => {
    const ctx = new FakeAudioContext();
    const eq = createCalibrationEq(ctx);
    eq.apply([1, 2, 3]);
    expect(eq.filters[0].gain.value).toBe(1);
    expect(eq.filters[2].gain.value).toBe(3);
    expect(eq.filters[3].gain.value).toBe(0);
    eq.apply(new Array(BANDS.length).fill(0));
    eq.filters.forEach(f => expect(f.gain.value).toBe(0));
  });
});
