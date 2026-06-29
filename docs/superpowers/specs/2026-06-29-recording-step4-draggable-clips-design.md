# Recording — Step 4: Draggable / Deletable Clips — Design

Date: 2026-06-29

## Goal

Let the user **move clips** horizontally on the timeline (reposition their start)
and **delete** a clip by dragging it out of the lane — mirroring the pedalboard's
pointer-drag + drag-off-to-delete pattern.

## Behavior

- **Move:** pointer-drag a clip horizontally; its `left` follows the cursor,
  clamped to ≥ 0 (no snapping for now). On drop, the take's `x` updates and
  playback uses the new position.
- **Delete:** drag a clip out of the lane (cursor above/below the track area by
  > 30px); a red cue shows on the lane and clip; on drop outside it is removed.
- Free positioning — clips may overlap; no auto-reflow.

## Component — `src/track-lane.js`

- `renderTrackLane(container, { presetName, bars, takes, onMoveClip, onDeleteClip })`.
- Each clip carries `data-take-id = String(take.n)` and a grab cursor.
- `enableClipDrag(clip, take, handlers, getArea)`:
  - `pointerdown` (button 0): record `startX`, `origLeft = take.x`; capture.
  - `pointermove`: `left = max(0, origLeft + dx)`; toggle `.will-delete` on clip
    and `.removing` on the area when the cursor is vertically outside the area.
  - `pointerup`: outside → `onDeleteClip(take.n)`; else `onMoveClip(take.n, left)`.
  - `pointercancel`: reset classes.
  - No-op if neither handler is supplied (keeps render pure for existing tests).

## Wiring — `src/main.js`

- `renderTrack()` passes:
  - `onMoveClip: (n, x) => { const t = takes.find(k => k.n === n); if (t) { t.x = Math.round(x); renderTrack(); } }`
  - `onDeleteClip: (n) => { takes = takes.filter(k => k.n !== n); renderTrack(); updateTransport(); }`

## Testing

- `tests/track-lane.test.js` (extend):
  - clip has `data-take-id`.
  - a pointerdown→move→up with a horizontal delta calls `onMoveClip(n, origLeft+dx)`.
  - a drag with the cursor above the lane (`clientY < top-30`, jsdom rects = 0)
    calls `onDeleteClip(n)`.
- Browser: drag a clip to a new position (playhead/playback reflect it); drag a
  clip out → it disappears; remaining clips intact.
- Existing tests stay green (amp.test.js failures pre-existing).

## Out of Scope (later)

- Snap-to-grid, clip resize/trim, copy, multi-select, undo, vertical track moves.
