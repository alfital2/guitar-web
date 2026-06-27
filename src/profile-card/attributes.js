// src/profile-card/attributes.js
export const STAT_ORDER = ['body', 'warmth', 'mids', 'presence', 'brightness', 'air'];

// Band index 9 (~8 kHz) is intentionally unused: electric guitars have essentially no
// energy that high, so it's just noise floor and would pin any stat using it at 0.
// "Air" is therefore measured at ~4.8 kHz (band 8), the genuine top of a guitar's range.
const GROUPS = {
  body: [0, 1], warmth: [2, 3], mids: [4, 5], presence: [6], brightness: [7], air: [8],
};

// Expected normalized-dB shape of a TYPICAL electric guitar (bass/mid heavy, rolls
// off the highs). Stats are scored relative to this, not to a flat spectrum — so a
// normal guitar reads ~50 across the board and the radar shows how it differs from
// typical.
const REFERENCE = { body: 4, warmth: 4, mids: 2, presence: -2, brightness: -6, air: -12 };

function groupAvg(fp, idxs) {
  let s = 0;
  for (const i of idxs) s += fp[i];
  return s / idxs.length;
}

export function fingerprintToStats(fingerprint) {
  const stats = {};
  for (const key of STAT_ORDER) {
    const dB = groupAvg(fingerprint, GROUPS[key]);
    stats[key] = Math.max(0, Math.min(100, Math.round(50 + (dB - REFERENCE[key]) * 5)));
  }
  return stats;
}

export function archetype(stats) {
  const vals = STAT_ORDER.map((k) => stats[k]);
  if (vals.every((v) => Math.abs(v - 50) <= 12)) return 'Balanced';
  const lowEnd = (stats.body + stats.warmth) / 2;
  const highEnd = (stats.brightness + stats.air) / 2;
  if (stats.mids >= 65 && stats.mids > stats.body && stats.mids > stats.brightness) return 'Mid-Forward';
  if (stats.mids <= 35 && lowEnd > stats.mids && highEnd > stats.mids) return 'Scooped';
  if (highEnd - lowEnd >= 12) return 'Bright & Glassy';
  if (lowEnd - highEnd >= 12) return 'Warm & Dark';
  return 'Balanced';
}
