// src/take-ops.js
// Pure take/clip operations on the timeline (testable without audio).
import { PX_PER_SEC } from './track-lane.js';

const EPS = 1e-6;
const lenOf = (t) => (t.len != null ? t.len : (t.duration || 0));
const repOf = (t) => (t.repeat && t.repeat > 1 ? t.repeat : 1);
// Full visible span in seconds: the trim window times its loop repetitions.
const spanOf = (t) => lenOf(t) * repOf(t);

// Minimal take covering `span` seconds of looped content that starts at the
// TOP of k's window: still a loop if the span exceeds one window, else a plain
// (possibly partial) window. Placed at timeline second `atSec`.
function shapedTake(k, span, atSec, n) {
  const base = { ...k, n, x: Math.round(atSec * PX_PER_SEC) };
  const len = lenOf(k);
  if (span > len + EPS) return { ...base, len, repeat: span / len };
  return { ...base, len: span, repeat: 1 };
}

// Keep the head [0, keepSpan) of take k. A loop right-trims cleanly: the whole
// repetitions survive and `repeat` just shrinks (possibly to a fraction ≤ 1,
// which collapses back to a plain window).
function keepHead(k, keepSpan) {
  return shapedTake(k, keepSpan, (k.x || 0) / PX_PER_SEC, k.n);
}

// Keep the tail of take k from `cut` seconds into its visible span, placed at
// timeline second `atSec`. A cut mid-window cannot be one (offset,len,repeat)
// take — the first partial repetition differs from the rest — so it flattens
// into a partial head piece plus a (possibly looped) clean remainder. All
// pieces share k's samples (windows only). Returns { pieces, nextN }.
function keepTail(k, cut, atSec, firstN, nextN) {
  const off = k.offset || 0, len = lenOf(k);
  const remain = spanOf(k) - cut;
  let within = cut - len * Math.floor(cut / len);      // position inside the repetition the cut lands in
  if (within > len - EPS) within = 0;                  // cut on (or a rounding hair before) a boundary
  if (within < EPS) return { pieces: [shapedTake(k, remain, atSec, firstN)], nextN };
  const headLen = Math.min(len - within, remain);      // tail of the interrupted repetition
  const pieces = [{ ...k, n: firstN, offset: off + within, len: headLen, repeat: 1, x: Math.round(atSec * PX_PER_SEC) }];
  const rest = remain - headLen;
  if (rest > EPS) pieces.push(shapedTake(k, rest, atSec + headLen, nextN++));
  return { pieces, nextN };
}

// Punch-in: a new take spanning [newStart, newEnd] seconds overwrites the audio
// under it. Existing takes are trimmed at the edges, split if the new take lands
// inside them, or dropped if fully covered. Non-destructive (offset/len only).
// Looped takes (repeat > 1) count their full span; a loop cut mid-window is
// flattened into window pieces (see keepTail) so nothing is misrepresented.
// `nextN` is the first take number available for any split piece. Returns the
// rewritten takes array and the next available take number.
export function punchTakes(takes, newStart, newEnd, nextN) {
  if (newEnd <= newStart) return { takes: takes.slice(), nextN };
  const out = [];
  for (const k of takes) {
    const s = (k.x || 0) / PX_PER_SEC, e = s + spanOf(k);
    if (e <= newStart || s >= newEnd) { out.push(k); continue; }       // no overlap
    if (s >= newStart && e <= newEnd) { continue; }                    // fully covered → drop
    if (s < newStart && e > newEnd) {                                  // new lands inside → split
      out.push(keepHead(k, newStart - s));
      const r = keepTail(k, newEnd - s, newEnd, nextN++, nextN);
      out.push(...r.pieces); nextN = r.nextN;
      continue;
    }
    if (s < newStart) out.push(keepHead(k, newStart - s));             // overlap on its right → trim right
    else {                                                             // overlap on its left → trim left
      const r = keepTail(k, newEnd - s, newEnd, k.n, nextN);
      out.push(...r.pieces); nextN = r.nextN;
    }
  }
  return { takes: out, nextN };
}

// Recording-latency compensation (classic DAW behavior). What lands in a take
// is what the player HEARD, delayed by the monitoring chain: the backing/click
// reaches the ears outputLatency late (plus, for overdubs, however long after
// capture start the backing was actually scheduled), and the response takes
// the input path back in. Trimming that head realigns the content to the grid
// — without it, overdubbed leads sit audibly behind the backing track.
//   playerT0/capStart: same-clock ctx times (0/null when no backing played).
//   base/output: AudioContext.baseLatency / outputLatency (undefined-safe).
// Clamped to [0, 0.12s] — a wild estimate must never eat real audio.
export function recordHeadTrimSec({ playerT0 = null, capStart = 0, baseLatency = 0, outputLatency = 0 } = {}) {
  const sched = playerT0 != null ? Math.max(0, playerT0 - capStart) : 0;
  const monitor = (baseLatency || 0) + (outputLatency || 0);
  return Math.min(0.12, Math.max(0, sched + monitor));
}
