// src/effects/ringmod.js — ring modulator. Multiplies the signal by a sine
// carrier (a bipolar gain whose value IS the carrier), giving metallic,
// bell-like, inharmonic tones. Dalek voices, "Paranoid Android" outro.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'ringmod',
  label: 'Ring Mod',
  params: [
    { key: 'freq', label: 'Freq', min: 20, max: 2000, default: 220, step: 1, unit: 'Hz' },
    { key: 'mix',  label: 'Mix',  min: 0,  max: 1,    default: 0.5, step: 0.01 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const ring = ctx.createGain();          // signal * carrier
  const wet = ctx.createGain();
  const carrier = ctx.createOscillator();
  carrier.type = 'sine';

  ring.gain.value = 0;                     // carrier (-1..1) sums in on top of 0
  input.connect(dry); dry.connect(output);
  input.connect(ring);
  carrier.connect(ring.gain);             // amplitude = carrier -> true ring mod
  ring.connect(wet); wet.connect(output);
  carrier.start();

  const apply = (p) => {
    carrier.frequency.value = p.freq;
    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, apply };
}
