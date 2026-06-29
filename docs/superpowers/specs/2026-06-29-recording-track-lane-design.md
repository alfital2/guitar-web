# Recording — Track Lane (Step 1 of N) — Design

Date: 2026-06-29

## Context

Recording is a large feature, decomposed into steps:

1. **Track-lane UI scaffold** (this spec) — header (preset name + inert controls)
   + empty timeline (bar ruler + playhead). No audio.
2. Record capture — Record button captures the live processed output to a take.
3. Waveform clip — render a captured take on the timeline (`<preset> #N`).
4. Playback + transport + moving playhead.
5. Polish — multiple takes, delete, wire mute/solo/monitor, tempo-synced ruler.

This spec covers **Step 1 only**.

## Goal

Add a GarageBand-style track lane **above the amp and pedalboard**, showing the
selected preset name and an empty timeline. UI scaffold only — no recording.

## Placement

A new `<section class="track-lane">` inserted in `.window-main` **between the
spectrum `.hero` and the `.amp-strip`**. The amp + pedalboard remain below it.

## Layout

One horizontal lane (header + timeline):

- **Header** (left, fixed `190px`, background `--surface`):
  - Instrument icon (small amp glyph) + the **active preset name**
    (`.track-name`, defaults to the loaded preset, e.g. "Edge of Breakup").
  - A row of three small **inert** buttons: mute (M), monitor (headphone),
    record-enable (●). `disabled`, tooltip "available with recording".
  - A volume `<input type=range>` (inert) + a pan knob placeholder (a small
    circle). Non-functional this step.
- **Timeline** (right, flex, background `--recessed`, `overflow-x: auto`):
  - **Bar ruler** strip across the top: numbered bars `1..N` (N = 16) at a fixed
    bar width (`64px`), tick marks at each bar.
  - Empty lane area below the ruler.
  - A **playhead**: a 1px accent vertical line parked at bar 1 (left edge),
    spanning ruler + lane.

## Component — `src/track-lane.js`

`renderTrackLane(container, { presetName, bars = 16 }) → void`

- Clears `container`, builds header + timeline as above.
- `.track-name` text = `presetName` (or "—" when falsy).
- Ruler: `bars` cells, each labeled with its 1-based number.
- Idempotent (safe to re-render on preset change).

## Wiring — `main.js`

- Add `renderTrack()` that calls `renderTrackLane($('track-lane'), { presetName:
  activePresetName })`, and call it from `loadPreset` (right after
  `activePresetName = preset.name`) and once on init — mirroring `renderBrowser`.

## Testing

- `tests/track-lane.test.js`:
  - renders a `.track-header` with `.track-name` equal to the given preset name.
  - renders `bars` ruler cells labeled `1..bars`.
  - renders exactly one `.track-playhead`.
  - empty/falsy `presetName` → `.track-name` shows `—`.
- All existing tests stay green.

## Out of Scope (this step)

- Any audio capture/playback, waveform, clips, moving playhead, working
  mute/solo/monitor/volume/pan, tempo sync. Those are later steps.
