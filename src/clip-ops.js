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

// Plan pasting/duplicating clips at a target position with no overlaps.
// `clips` is [{ trackId, dx, take }] — dx is each clip's horizontal offset (px)
// from the paste anchor (relative arrangement; leftmost = 0). `targetX` is the
// anchor's desired x in px (e.g. the playhead). `occupiedByTrack` maps
// trackId → [{x, w}] of that track's EXISTING clips; `widthOf(take)` gives a
// clip's rendered width in px. Clips are placed leftmost-first through
// resolveNoOverlap, and each placement joins the running occupancy so pasted
// clips also never overlap each other. Returns [{ trackId, take, x }].
export function planPaste(clips, targetX, occupiedByTrack, widthOf) {
  const occ = new Map();
  const out = [];
  for (const c of [...clips].sort((a, b) => (a.dx || 0) - (b.dx || 0))) {
    if (!occ.has(c.trackId)) occ.set(c.trackId, (occupiedByTrack.get(c.trackId) || []).slice());
    const slots = occ.get(c.trackId);
    const w = widthOf(c.take);
    const x = Math.max(0, Math.round(resolveNoOverlap(slots, targetX + (c.dx || 0), w)));
    slots.push({ x, w });
    out.push({ trackId: c.trackId, take: c.take, x });
  }
  return out;
}

// Sample buffers are treated as IMMUTABLE app-wide: the recorder allocates a
// fresh Float32Array per take, and everything downstream (player, waveform,
// undo snapshots) only reads. Clones and split halves therefore share the same
// buffer and differ only in their offset/len window.
export function cloneTake(t) {
  return {
    n: t.n, name: t.name, sampleRate: t.sampleRate, duration: t.duration, x: t.x,
    offset: t.offset, len: t.len, repeat: t.repeat,
    samples: t.samples, // shared by design (immutable; see note above)
  };
}

// Clamp a loop `repeat` (GarageBand loop-drag) so the clip — window `lenSec`
// at `xPx` — never extends into the next occupied slot to its right.
// `occupied` is [{x, w}] excluding the clip itself. Repeats that end up below
// 1.05 collapse to exactly 1 (loop removed), mirroring the drag snap-back.
export function clampRepeat(occupied, xPx, lenSec, repeat, pxPerSec) {
  let rep = Math.max(1, repeat || 1);
  if (!(lenSec > 0)) return 1;
  const next = occupied.reduce((m, o) => (o.x >= xPx ? Math.min(m, o.x) : m), Infinity);
  if (Number.isFinite(next)) rep = Math.min(rep, Math.max(1, (next - xPx) / pxPerSec / lenSec));
  return rep < 1.05 ? 1 : rep;
}

// Split a take at `offsetSec` from the start of its VISIBLE window (offset/len)
// into [left, right]. Pure window split: both halves share the take's samples;
// only the trim windows differ. `right` gets a fresh take number and sits at
// the split point. Null if the split falls outside the window (50ms margin).
// Looped takes (repeat > 1) are NOT splittable (v1): a mid-window head-cut of a
// loop is not representable as one (offset,len,repeat) window — the first
// partial repetition would differ from the rest — so we reject rather than
// corrupt. (Punch-in recording handles this by flattening; see take-ops.js.)
export function splitTakeAt(take, offsetSec, nextN, pxPerSec) {
  if (take.repeat && take.repeat > 1) return null;
  const off = take.offset || 0;
  const len = take.len != null ? take.len : take.duration;
  if (!(offsetSec > 0.05) || !(offsetSec < len - 0.05)) return null;
  const left = { ...take, len: offsetSec }; // keeps x, offset, samples
  const right = {
    ...take, n: nextN,
    offset: off + offsetSec, len: len - offsetSec,
    x: (take.x || 0) + Math.round(offsetSec * pxPerSec),
  };
  return [left, right];
}
