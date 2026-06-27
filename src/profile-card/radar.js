// src/profile-card/radar.js
import { STAT_ORDER } from './attributes.js';

export function radarPoints(stats, cx, cy, radius) {
  return STAT_ORDER.map((key, i) => {
    const angle = -Math.PI / 2 + i * (2 * Math.PI / 6); // top, clockwise
    const r = radius * (stats[key] / 100);
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}
