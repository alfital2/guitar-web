# Recording — Step 3: Playback + Moving Playhead — Design

Date: 2026-06-29

## Goal

Play recorded takes back through the transport, with a playhead that sweeps the
timeline. Builds on Steps 1–2.

- **Play** (`#tp-play`): plays all takes from the start; toggles to Stop.
- **Skip-to-start** (`#tp-start`): stops and resets the playhead to bar 1.
- **Playhead**: the existing `.track-playhead` line moves right during playback
  at `PX_PER_SEC`; returns to 0 at the end or on skip-to-start.
- Play/skip enabled only when at least one take exists.
- Playback works even when the engine is stopped (own AudioContext).

## Module — `src/player.js`

- `playbackDuration(takes) → seconds` (pure): `max(take.x/PX_PER_SEC +
  take.duration)` over takes, else 0.
- `createPlayer() → { play, stop, isPlaying }`:
  - `play(takes, onTick, onEnd)`: lazily create/resume an `AudioContext`; for
    each take build a mono `AudioBuffer` from `take.samples` at `take.sampleRate`
    and schedule an `AudioBufferSourceNode` at `t0 + take.x/PX_PER_SEC`
    (`t0 = currentTime + 0.06`). Run a rAF clock: `onTick(elapsedSeconds)` each
    frame; when `elapsed >= playbackDuration` → `stop()` then `onEnd()`.
  - `stop()`: cancel the clock, stop all sources.
  - No-op when no `AudioContext` (tests) or `playbackDuration <= 0`.

## Wiring — `src/main.js`

- `const player = createPlayer();`
- `setPlayhead(sec)`: set `.track-playhead` `left = sec * PX_PER_SEC` px.
- `#tp-play` click: if playing → `player.stop()`, clear `.on`; else (takes exist)
  → `.on`, `player.play(takes, setPlayhead, () => { clear .on; setPlayhead(0) })`.
- `#tp-start` click: `player.stop()`, clear `#tp-play .on`, `setPlayhead(0)`.
- `updateTransport()`: enable/disable `#tp-play` and `#tp-start` based on
  `takes.length > 0`; call after pushing a take and once on init.
- Engine `stop()` also stops the player and resets the playhead.

## Testing

- `tests/player.test.js`: `playbackDuration` — empty → 0; single take at x=0 dur
  2 → 2; two takes (x=0 dur2 ; x=64 dur1 → 64/32 + 1 = 3) → 3; `createPlayer().play`
  is a no-op without `AudioContext` and `isPlaying()` stays false.
- Browser: record two takes → Play sweeps the playhead and audio plays; reaching
  the end resets; Skip-to-start resets; play/skip disabled with no takes.
- Existing tests stay green (amp.test.js failures pre-existing/out of scope).

## Out of Scope (later)

- Pause/resume mid-clip, play from playhead position, loop, per-take routing
  through effects, draggable clips, delete, tempo-synced widths.
