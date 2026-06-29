# Recording — Step 6: Scrub Playhead + Snap-to-Grid — Design

Date: 2026-06-29

## Goal

Let users place the playhead precisely by **dragging** it (scrubbing the ruler),
and add a **snap-to-grid** toggle that snaps the playhead and clip moves to the
beat grid.

## Behavior

- **Scrub:** press-drag on the ruler (or the playhead grip) moves the playhead in
  real time. A small grip (triangle) sits at the top of the playhead.
- **Snap toggle:** a button in the track header (default **on**). When on, the
  playhead (scrub + click-seek) and clip drops snap to the nearest **beat**
  (`SNAP_PX = 16px` = 0.5s @ 120 BPM 4/4). When off, free placement.
- Single click on the timeline still seeks (snapped when snap is on).

## Component — `src/track-lane.js`

- `renderTrackLane(container, { …, snap, onToggleSnap })`.
- Header: a `.snap-toggle` button (`#snap-toggle`), `.on` when `snap`, calls
  `onToggleSnap` on click. Title "Snap to grid".
- Playhead: add a `.playhead-grip` child (triangle handle at the top).

## Wiring — `src/main.js`

- `let snapOn = true;` `const SNAP_PX = 16;`
  `function snapPx(x) { return snapOn ? Math.round(x / SNAP_PX) * SNAP_PX : x; }`
- `renderTrack()` passes `snap: snapOn, onToggleSnap: () => { snapOn = !snapOn; renderTrack(); }`.
- `onMoveClip(n, x)` → `t.x = Math.max(0, Math.round(snapPx(x)))`.
- Click-seek → `setPlayhead(snapPx(x) / PX_PER_SEC)`.
- **Scrub:** delegated `pointerdown` on `#track-lane`; if target is in
  `.track-ruler` or `.playhead-grip` (and not a clip), begin scrubbing:
  compute `x = clientX - timeline.rect.left + timeline.scrollLeft`,
  `player.stop()`, clear Play `.on`, `setPlayhead(snapPx(max(0,x)) / PX_PER_SEC)`;
  window `pointermove` continues, `pointerup` ends.

## Testing

- `tests/track-lane.test.js` (extend): renders a `.snap-toggle` reflecting the
  `snap` flag; clicking it calls `onToggleSnap`; renders a `.playhead-grip`.
- Browser: drag the ruler → playhead follows and snaps to beats; toggle snap off →
  free placement; clip drops snap when on.
- Existing tests stay green (amp.test.js failures pre-existing).

## Out of Scope

- Multi-track, per-track mixer, undo (later steps B–D); scrub-while-playing,
  loop region, tempo other than 120.
