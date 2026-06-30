// src/take-ops.js
// Pure take/clip operations on the timeline (testable without audio).
import { PX_PER_SEC } from './track-lane.js';

const lenOf = (t) => (t.len != null ? t.len : (t.duration || 0));

// Punch-in: a new take spanning [newStart, newEnd] seconds overwrites the audio
// under it. Existing takes are trimmed at the edges, split if the new take lands
// inside them, or dropped if fully covered. Non-destructive (offset/len only).
// `nextN` is the first take number available for any split piece. Returns the
// rewritten takes array and the next available take number.
export function punchTakes(takes, newStart, newEnd, nextN) {
  if (newEnd <= newStart) return { takes: takes.slice(), nextN };
  const out = [];
  for (const k of takes) {
    const off = k.offset || 0, len = lenOf(k);
    const s = (k.x || 0) / PX_PER_SEC, e = s + len;
    if (e <= newStart || s >= newEnd) { out.push(k); continue; }       // no overlap
    if (s >= newStart && e <= newEnd) { continue; }                    // fully covered → drop
    if (s < newStart && e > newEnd) {                                  // new lands inside → split
      out.push({ ...k, len: newStart - s });
      out.push({ ...k, n: nextN++, offset: off + (newEnd - s), len: e - newEnd, x: Math.round(newEnd * PX_PER_SEC) });
      continue;
    }
    if (s < newStart) out.push({ ...k, len: newStart - s });           // overlap on its right → trim right
    else { const cut = newEnd - s; out.push({ ...k, offset: off + cut, len: len - cut, x: Math.round(newEnd * PX_PER_SEC) }); } // trim left
  }
  return { takes: out, nextN };
}
