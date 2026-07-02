// src/effects/acousticsim.js — acoustic guitar simulator (Boss AC-2 territory).
// An electric pickup lacks the resonant body of a dreadnought: fake it with
// peaking biquads at the classic body-resonance spots (~100Hz air cavity,
// ~230Hz top plate) plus a high-shelf "air"/string-sparkle lift, behind a
// gentle high-pass that removes electric-pickup mud.
import { mapRange } from '../dsp.js';

export const schema = {
  type: 'acousticsim',
  label: 'Acoustic Sim',
  params: [
    { key: 'body',  label: 'Body',  min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'air',   label: 'Air',   min: 0, max: 10, default: 5, step: 0.1 },
    { key: 'level', label: 'Level', min: 0, max: 10, default: 5, step: 0.1 },
  ],
};

export function create(ctx, params) {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();   hp.type = 'highpass'; hp.frequency.value = 90; hp.Q.value = 0.7;
  const body1 = ctx.createBiquadFilter(); body1.type = 'peaking'; body1.frequency.value = 105; body1.Q.value = 1.6;
  const body2 = ctx.createBiquadFilter(); body2.type = 'peaking'; body2.frequency.value = 230; body2.Q.value = 1.4;
  const airShelf = ctx.createBiquadFilter(); airShelf.type = 'highshelf'; airShelf.frequency.value = 6500;
  const output = ctx.createGain();
  input.connect(hp); hp.connect(body1); body1.connect(body2); body2.connect(airShelf); airShelf.connect(output);

  const apply = (p) => {
    body1.gain.value = mapRange(p.body, 0, 10, 0, 9);   // air-cavity thump
    body2.gain.value = mapRange(p.body, 0, 10, 0, 7);   // top-plate honk
    airShelf.gain.value = mapRange(p.air, 0, 10, 0, 12); // string sparkle
    output.gain.value = mapRange(p.level, 0, 10, 0, 2);  // default 5 -> unity
  };
  apply(params);
  return { input, output, apply };
}
