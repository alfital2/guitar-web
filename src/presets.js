import clean from './presets/clean.json' with { type: 'json' };
import mayerEdge from './presets/mayer-edge.json' with { type: 'json' };
import mayerLead from './presets/mayer-lead.json' with { type: 'json' };
import knopflerSultans from './presets/knopfler-sultans.json' with { type: 'json' };
import asatoClean from './presets/asato-clean.json' with { type: 'json' };
import hensonClean from './presets/henson-clean.json' with { type: 'json' };
import hetfieldRhythm from './presets/hetfield-rhythm.json' with { type: 'json' };
import hammettLead from './presets/hammett-lead.json' with { type: 'json' };
import funkAutowah from './presets/funk-autowah.json' with { type: 'json' };
import fuzzFace from './presets/fuzz-face.json' with { type: 'json' };
import ambientWash from './presets/ambient-wash.json' with { type: 'json' };
import surfTremolo from './presets/surf-tremolo.json' with { type: 'json' };
import swirlPhaser from './presets/swirl-phaser.json' with { type: 'json' };
import octaveDown from './presets/octave-down.json' with { type: 'json' };
import proJcm from './presets/pro-jcm.json' with { type: 'json' };
import pro5153 from './presets/pro-5153.json' with { type: 'json' };
import proDeluxe from './presets/pro-deluxe.json' with { type: 'json' };
import proAc10 from './presets/pro-ac10.json' with { type: 'json' };
import proJc from './presets/pro-jc.json' with { type: 'json' };
import { GB_PRESETS } from './presets/garageband.js';

// Artist/utility presets, then all GarageBand patches (tagged with a category).
export const PRESETS = [clean, mayerEdge, mayerLead, knopflerSultans, asatoClean, hensonClean, hetfieldRhythm, hammettLead,
  funkAutowah, fuzzFace, ambientWash, surfTremolo, swirlPhaser, octaveDown,
  proJcm, pro5153, proDeluxe, proAc10, proJc,
  ...GB_PRESETS];

// Browser categories: GarageBand patches plus the artist/showcase presets that
// used to live in the toolbar dropdown.
export const GB_CATEGORIES = [
  { id: 'clean', label: '01 Clean Guitar', presets: GB_PRESETS.filter((p) => p.category === 'clean') },
  { id: 'crunch', label: '02 Crunch Guitar', presets: GB_PRESETS.filter((p) => p.category === 'crunch') },
  { id: 'artists', label: '03 Artist Rigs', presets: [mayerEdge, mayerLead, knopflerSultans, asatoClean, hensonClean, hetfieldRhythm, hammettLead] },
  { id: 'showcase', label: '04 Showcase FX', presets: [clean, funkAutowah, fuzzFace, ambientWash, surfTremolo, swirlPhaser, octaveDown] },
  // 05 Professional: real captured amps (NAM WaveNet). Each preset is a single
  // `neuralamp` amp-head node; loudness is normalized at load time by the same
  // offline measurement path as every other preset (see normalize.js).
  { id: 'pro', label: '05 Professional', presets: [proJcm, pro5153, proDeluxe, proAc10, proJc] },
];

export function validatePreset(preset, registry) {
  const errors = [];
  for (const entry of preset.chain) {
    const def = registry[entry.type];
    if (!def) { errors.push(`Unknown effect type: ${entry.type}`); continue; }
    const known = new Set(def.schema.params.map(p => p.key));
    for (const key of Object.keys(entry.params || {})) {
      if (!known.has(key)) errors.push(`${entry.type}: unknown param "${key}"`);
    }
  }
  return errors;
}
