# Recording — Step 7 (B): Multi-Track — Design

Date: 2026-06-29

## Goal

Support multiple audio tracks (strips): add/remove tracks, arm one to record into,
and play all tracks together. GarageBand two-column layout (headers + timelines)
with a shared ruler and a single playhead. Per-track mixer audio (mute/solo/
volume/pan) and undo are later steps (C, D).

## Data Model (`src/main.js`)

- `tracks`: `Array<{ id, name, armed, takes: [] }>`. `takes` per track:
  `{ n, name, x, samples, sampleRate, duration }` (as today).
- `nextTrackId` (1-based), `takeSeq` (global, for clip numbers).
- On init: one track `{ id: 1, name: activePresetName, armed: true, takes: [] }`.
- Exactly one armed track (radio). Arming a track disarms the rest.

## Layout (`src/track-lane.js`)

`renderTrackLane(container, { tracks, bars, armedId, snap, handlers })` builds:

- `.track-lane-row` → two columns:
  - **`.track-headers`** (fixed 190px): a `.track-add` (＋ Add Track) row, then a
    `.track-header` per track containing: name, `M`/monitor/`●`(arm) buttons,
    volume+pan (inert), and a `.track-remove` (×). Header height = `ROW_H` (124px).
  - **`.track-timeline`** (flex, `overflow-x:auto`): a `.track-scroll` holding the
    `.track-ruler` (numbered bars) on top, then one `.track-strip` per track
    (height `ROW_H`) containing that track's clips; and a single
    `.track-playhead` (with `.playhead-grip`) spanning all strips.
- Each clip: `.track-clip` with `data-track-id` + `data-take-id`.
- The armed track's header gets `.armed`; its `●` arm button gets `.on`.

### handlers (passed from main)
- `onAddTrack()`, `onRemoveTrack(trackId)`, `onArm(trackId)`, `onToggleSnap()`.
- `onMoveClip(trackId, takeId, x)`, `onDeleteClip(trackId, takeId)`.

`enableClipDrag` now reports `(trackId, takeId, x)` / `(trackId, takeId)`.

## Wiring (`src/main.js`)

- `renderTrack()` passes `tracks`, `armedId`, `snap`, handlers.
- **Add track:** `tracks.push({ id: nextTrackId++, name: activePresetName, armed: true, takes: [] })`,
  disarm others, `renderTrack()`.
- **Remove track:** drop it; if it was armed, arm the last remaining (if any);
  `renderTrack()`, `updateTransport()`.
- **Arm:** set `armed` on the clicked track, clear others; `renderTrack()`.
- **Record:** captures into the **armed** track — live clip drawn in that track's
  strip; on stop push the take to `armedTrack.takes` and `renderTrack()`.
- **Move/delete clip:** locate `(trackId, takeId)` in `tracks`; update/remove;
  snap applies to move as in step 6.
- **Playback:** flatten `tracks.flatMap(t => t.takes)` → `player.play(...)`.
  `playbackDuration` over the flattened list; play/seek/scrub unchanged.
- `updateTransport()`: play/skip enabled when any track has a take.
- The live-record clip is appended to the **armed track's** `.track-strip`.

## Migration

- The current single-track behavior becomes `tracks[0]`. `loadPreset` no longer
  owns takes; switching presets updates `activePresetName` (used for new tracks
  and the next recording's sound) but does **not** rename existing tracks.

## Testing

- `tests/track-lane.test.js` (rewrite for multi-track):
  - renders one `.track-header` per track and one `.track-strip` per track.
  - renders a `.track-add` control; clicking calls `onAddTrack`.
  - the armed track's header has `.armed`; clicking another track's `●` calls
    `onArm(thatId)`.
  - `.track-remove` calls `onRemoveTrack(id)`.
  - a clip carries `data-track-id` + `data-take-id`; drag-move calls
    `onMoveClip(trackId, takeId, x)`; drag-out calls `onDeleteClip(trackId, takeId)`.
  - one shared `.track-ruler` and one `.track-playhead` regardless of track count.
- Browser: add 2 tracks; arm each and record; clips land in the right strip; Play
  mixes all; remove a track; scrub/snap still work; no horizontal scroll.
- Existing tests stay green (amp.test.js failures pre-existing/out of scope).

## Out of Scope (later)

- Per-track mute/solo/monitor/volume/pan **audio** routing (step C), undo (D),
  per-track input selection, reordering tracks, track colors.
