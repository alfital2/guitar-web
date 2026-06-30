// src/effects/rotary.js — rotary (Leslie) speaker simulation.
// A real Leslie splits the signal to a treble horn and a bass drum spinning at
// different speeds; the listener hears pitch (Doppler), amplitude and stereo
// position all modulating together. We approximate that with a 2-band crossover,
// each band fed through a modulated delay (Doppler), a tremolo gain and a swept
// stereo panner, the horn band spinning faster than the bass drum.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'rotary',
  label: 'Rotary',
  params: [
    { key: 'speed', label: 'Speed', min: 0, max: 10, default: 6, step: 0.1 }, // chorale..tremolo
    { key: 'depth', label: 'Depth', min: 0, max: 10, default: 6, step: 0.1 },
    { key: 'mix',   label: 'Mix',   min: 0, max: 1,  default: 0.6, step: 0.01 },
  ],
};

// Build one spinning rotor: band -> delay(Doppler) -> trem -> panner -> dest.
function rotor(ctx, src, dest) {
  const delay = ctx.createDelay(0.05);
  const trem = ctx.createGain();
  const panner = ctx.createStereoPanner();
  const osc = ctx.createOscillator(); osc.type = 'sine';
  const dopMod = ctx.createGain();
  const tremMod = ctx.createGain();
  const panMod = ctx.createGain();

  delay.delayTime.value = 0.006;
  src.connect(delay); delay.connect(trem); trem.connect(panner); panner.connect(dest);
  osc.connect(dopMod); dopMod.connect(delay.delayTime);
  osc.connect(tremMod); tremMod.connect(trem.gain);
  osc.connect(panMod); panMod.connect(panner.pan);
  osc.start();
  return { osc, dopMod, tremMod, panMod, trem };
}

export function create(ctx, params) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();

  // Crossover ~800 Hz: horn (highs) vs bass drum (lows).
  const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 800;
  const low = ctx.createBiquadFilter();  low.type = 'lowpass';  low.frequency.value = 800;
  input.connect(high); input.connect(low);
  input.connect(dry); dry.connect(output);
  wet.connect(output);

  const horn = rotor(ctx, high, wet);  // fast rotor
  const drum = rotor(ctx, low, wet);   // slow rotor

  const apply = (p) => {
    // Speed: chorale (~0.8 Hz) up to fast tremolo (~6.8 Hz). Drum lags the horn.
    const hornHz = mapRange(p.speed, 0, 10, 0.8, 6.8);
    const drumHz = hornHz * 0.82;
    horn.osc.frequency.value = hornHz;
    drum.osc.frequency.value = drumHz;

    const d = p.depth / 10;
    horn.dopMod.gain.value = 0.0016 * d;  // horn = brighter, more audible Doppler
    drum.dopMod.gain.value = 0.0026 * d;  // drum = lower, deeper pitch swing
    horn.tremMod.gain.value = 0.45 * d;   // amplitude throb
    drum.tremMod.gain.value = 0.30 * d;
    horn.trem.gain.value = 1 - 0.45 * d / 2;
    drum.trem.gain.value = 1 - 0.30 * d / 2;
    horn.panMod.gain.value = 0.9 * d;     // wide stereo sweep for the horn
    drum.panMod.gain.value = 0.4 * d;

    wet.gain.value = p.mix;
    dry.gain.value = 1 - p.mix;
  };
  apply(params);
  return { input, output, apply };
}
