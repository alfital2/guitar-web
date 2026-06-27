// src/profile-card/attributes.js
export const STAT_ORDER = ['body', 'warmth', 'mids', 'presence', 'brightness', 'air'];

const GROUPS = {
  body: [0, 1], warmth: [2, 3], mids: [4, 5], presence: [6], brightness: [7, 8], air: [9],
};

// Expected normalized-dB shape of a TYPICAL electric guitar (bass/mid heavy, rolls
// off the highs). Stats are scored relative to this, not to a flat spectrum — so a
// normal guitar reads ~50 across the board and the radar shows how it differs from
// typical. Without this, every guitar's top end (Air especially) pins at 0, because
// guitars naturally have almost no 8 kHz energy.
const REFERENCE = { body: 4, warmth: 4, mids: 2, presence: -2, brightness: -6, air: -10 };

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
