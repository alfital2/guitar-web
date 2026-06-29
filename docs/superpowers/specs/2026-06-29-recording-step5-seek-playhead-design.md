# Recording — Step 5: Click-to-Seek + Play-from-Playhead — Design

Date: 2026-06-29

## Goal

Click the timeline to move the playhead; Play starts from the playhead position
(not always bar 1). Skip-to-start returns to 0.

## Behavior

- **Seek:** clicking an empty part of the timeline moves the playhead to that x
  (`sec = x / PX_PER_SEC`). Clicking a clip does not seek (it drags).
- **Play from playhead:** Play schedules takes relative to the current playhead
  time; takes already finished before that time are skipped, a take straddling it
  starts partway in. The playhead sweeps from its current spot.
- **Stop (toggle Play):** leaves the playhead where it stopped (so Play resumes
  from there).
- **Skip-to-start:** stops and parks the playhead at 0.
- Natural end of playback resets the playhead to 0.

## Player — `src/player.js`

- `play(takes, fromSec, onTick, onEnd)` (was `play(takes, onTick, onEnd)`):
  - `t0 = currentTime + 0.06`. For each take with `start = take.x/PX_PER_SEC`,
    `end = start + duration`: skip if `end <= fromSec`; `rel = start - fromSec`;
    if `rel >= 0` → `source.start(t0 + rel)`, else `source.start(t0, -rel)`
    (begin `-rel` seconds into the buffer).
  - Clock: `onTick(fromSec + (currentTime - t0))`; ends when
    `fromSec + elapsed >= playbackDuration(takes)`.

## Wiring — `src/main.js`

- `let playheadSec = 0;` `setPlayhead(sec)` sets the line **and** stores `playheadSec`.
- Play click: playing → `player.stop()` (ticks have updated `playheadSec`); else
  `player.play(takes, playheadSec, setPlayhead, () => { clear .on; setPlayhead(0); })`.
- Skip click: `player.stop()`, clear `.on`, `setPlayhead(0)`.
- Seek: a delegated `click` on `#track-lane` — ignore if `e.target.closest('.track-clip')`;
  else, with `tl = .track-timeline`, `x = e.clientX - tl.rect.left + tl.scrollLeft`;
  `player.stop()`, clear Play `.on`, `setPlayhead(max(0, x / PX_PER_SEC))`.

## Testing

- `tests/player.test.js`: update the no-audio call to the new `play(takes, 0, …)`
  signature; `playbackDuration` tests unchanged.
- Browser: record two takes; click mid-timeline → playhead jumps there; Play →
  sweeps from there and only later audio plays; Skip → playhead to 0; clicking a
  clip does not seek.

## Out of Scope

- Snap-to-grid seek, loop region, scrub-while-playing, ruler time display.
