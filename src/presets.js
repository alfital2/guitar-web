import clean from './presets/clean.json' with { type: 'json' };
import mayerEdge from './presets/mayer-edge.json' with { type: 'json' };
import mayerLead from './presets/mayer-lead.json' with { type: 'json' };
import knopflerSultans from './presets/knopfler-sultans.json' with { type: 'json' };
import asatoClean from './presets/asato-clean.json' with { type: 'json' };
import hensonClean from './presets/henson-clean.json' with { type: 'json' };

export const PRESETS = [clean, mayerEdge, mayerLead, knopflerSultans, asatoClean, hensonClean];

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
