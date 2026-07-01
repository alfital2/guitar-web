// src/effects/index.js
import * as compressor from './compressor.js';
import * as drive from './drive.js';
import * as eq from './eq.js';
import * as cabinet from './cabinet.js';
import * as delay from './delay.js';
import * as reverb from './reverb.js';
import * as chorus from './chorus.js';
import * as boost from './boost.js';
import * as fuzz from './fuzz.js';
import * as octave from './octave.js';
import * as tremolo from './tremolo.js';
import * as vibrato from './vibrato.js';
import * as flanger from './flanger.js';
import * as phaser from './phaser.js';
import * as ringmod from './ringmod.js';
import * as autowah from './autowah.js';
import * as gate from './gate.js';
import * as wah from './wah.js';
import * as tapeEcho from './tape-echo.js';
import * as pingpong from './pingpong.js';
import * as widener from './widener.js';
import * as limiter from './limiter.js';
import * as pitchshift from './pitchshift.js';
import * as looper from './looper.js';
import * as autopan from './autopan.js';
import * as rotary from './rotary.js';
import * as neuralamp from './neuralamp.js';

const mods = [
  compressor, drive, eq, cabinet, delay, reverb, chorus,
  boost, fuzz, octave, tremolo, vibrato, flanger, phaser, ringmod,
  autowah, gate, wah, tapeEcho, pingpong, widener, limiter,
  pitchshift, looper, autopan, rotary, neuralamp,
];

export const registry = Object.fromEntries(
  mods.map((m) => [m.schema.type, { schema: m.schema, create: m.create }])
);
