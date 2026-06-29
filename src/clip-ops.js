// src/clip-ops.js
// Pure clip operations for copy/paste/split on the track lane.

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
