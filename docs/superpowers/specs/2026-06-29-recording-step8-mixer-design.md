# Recording — Step 8 (C): Per-Track Mixer — Design

Date: 2026-06-29

## Goal

Make mute / solo / volume / pan affect playback per track. (Monitor stays inert —
live-input monitoring is a separate concern; deferred.)

## Track mix state (`src/main.js`)

Each track gains: `volume` (0–1, default 0.8), `pan` (−1…1, default 0),
`mute` (bool), `solo` (bool).

- Effective gain: if **any** track is soloed → soloed tracks play at their volume,
  others are silent; else a muted track is silent, otherwise its volume.
- `trackGain(t, anySolo) = anySolo ? (t.solo ? t.volume : 0) : (t.mute ? 0 : t.volume)`.

## Player (`src/player.js`)

- `play(groups, fromSec, onTick, onEnd)` where `groups = [{ id, takes, gain, pan }]`.
  Per group: a `GainNode(gain) → StereoPanner(pan) → destination`; each take's
  source connects to that group gain. (`playbackDuration` stays pure over the
  flattened takes.)
- `setTrackGain(id, g)` / `setTrackPan(id, p)`: update the live nodes
  (`setTargetAtTime`) so mixer moves are heard immediately while playing.

## UI (`src/track-lane.js`)

Track header controls become functional (monitor stays disabled):
- **M** mute toggle (`.track-mute`, `.on` when muted) → `onMute(id)`.
- **S** solo toggle (new `.track-solo`, `.on` when soloed) → `onSolo(id)`.
- **Volume**: `.track-vol` range, value = `track.volume`, `input` → `onVolume(id, v)`.
- **Pan**: `.track-pan` small knob; horizontal pointer-drag sets pan −1…1, the dot
  rotates `pan*135deg`; → `onPan(id, p)`. Double-click resets to 0.

## Wiring (`src/main.js`)

- New tracks include `volume:0.8, pan:0, mute:false, solo:false`.
- `buildGroups()` maps tracks → `{ id, takes, gain: trackGain(t, anySolo), pan: t.pan }`.
- Play uses `player.play(buildGroups(), playheadSec, …)`.
- Handlers update state then, if playing, push live: volume/pan →
  `setTrackGain/Pan(id, …)`; mute/solo → recompute **all** gains (solo affects all)
  and `setTrackGain` each. Always `renderTrack()` to reflect button/slider state.

## Testing

- `tests/player.test.js`: update the no-audio `play` call to the `groups` shape;
  `playbackDuration` unchanged.
- `tests/track-lane.test.js`: M/S toggles call `onMute`/`onSolo(id)` and reflect
  `.on` from `track.mute`/`track.solo`; volume input calls `onVolume(id, value)`;
  pan drag calls `onPan(id, …)`.
- Browser: two tracks; mute one → only the other plays; solo one → only it plays;
  move a volume slider / pan while playing → heard live (verified via node values).
- Existing tests stay green (amp.test.js failures pre-existing).

## Out of Scope

- Monitor / live input routing, master bus metering, automation, undo (step D).
