// src/clip-ops.js
// Pure clip operations for copy/paste/split on the track lane.

const overlaps = (x, w, occ) => occ.some((o) => x < o.x + o.w && x + w > o.x);

// Find a non-overlapping x for a clip of `width`, nearest to `desiredX`, among
// the `occupied` slots ([{x, w}]). Clips never overlap on a track (like effects).
export function resolveNoOverlap(occupied, desiredX, width) {
  let x = Math.max(0, desiredX);
  if (!overlaps(x, width, occupied)) return x;
  const cands = [0];
  for (const o of occupied) { cands.push(Math.max(0, o.x - width)); cands.push(o.x + o.w); }
  const valid = cands.filter((c) => c >= 0 && !overlaps(c, width, occupied));
  if (!valid.length) return occupied.reduce((m, o) => Math.max(m, o.x + o.w), 0); // append at the end
  valid.sort((a, b) => Math.abs(a - desiredX) - Math.abs(b - desiredX));
  return valid[0];
}

export function cloneTake(t) {
  return { name: t.name, sampleRate: t.sampleRate, duration: t.duration, x: t.x, samples: new Float32Array(t.samples) };
}

// Split a take at `offsetSec` from its start into [left, right]; `right` gets a
// fresh take number and is positioned at the split point. Null if the offset is
// outside the clip.
export function splitTakeAt(take, offsetSec, nextN, pxPerSec) {
  if (!(offsetSec > 0) || offsetSec >= take.duration) return null;
  const idx = Math.round(offsetSec * take.sampleRate);
  if (idx <= 0 || idx >= take.samples.length) return null;
  const left = { ...take, samples: take.samples.slice(0, idx), duration: idx / take.sampleRate };
  const right = {
    name: take.name, sampleRate: take.sampleRate,
    samples: take.samples.slice(idx), duration: (take.samples.length - idx) / take.sampleRate,
    x: (take.x || 0) + Math.round(offsetSec * pxPerSec), n: nextN,
  };
  return [left, right];
}
