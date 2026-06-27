// src/effects/index.js
import * as compressor from './compressor.js';
import * as drive from './drive.js';
import * as eq from './eq.js';
import * as cabinet from './cabinet.js';
import * as delay from './delay.js';
import * as reverb from './reverb.js';
import * as chorus from './chorus.js';

export const registry = {
  compressor: { schema: compressor.schema, create: compressor.create },
  drive:      { schema: drive.schema,      create: drive.create },
  eq:         { schema: eq.schema,         create: eq.create },
  cabinet:    { schema: cabinet.schema,    create: cabinet.create },
  delay:      { schema: delay.schema,      create: delay.create },
  reverb:     { schema: reverb.schema,     create: reverb.create },
  chorus:     { schema: chorus.schema,     create: chorus.create },
};
