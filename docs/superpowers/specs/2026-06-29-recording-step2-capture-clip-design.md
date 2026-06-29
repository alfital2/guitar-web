# Recording — Step 2: Capture + Waveform Clip — Design

Date: 2026-06-29

## Goal

Make the transport **Record** button capture the live processed guitar output and
render it as a **clip** on the track lane: a GarageBand-style **indigo/purple**
clip with a **light-lavender waveform** and a `<preset> #N` label. Theme-independent
clip colors (retained from GarageBand regardless of the app accent).

Builds on Step 1 (track-lane scaffold). Playback/transport-driven playhead is a
later step.

## Capture

- Records the **processed output** (post-effects) so the take is what you hear,
  independent of the master Vol slider. Tap `engine.output`.
- Only available while the **engine is live** (after START). Record button is
  `disabled` otherwise; main.js enables it in `start()` and disables in `stop()`.
- Mechanism: a `ScriptProcessorNode` (bufferSize 4096, mono) on the live
  `AudioContext`. `engine.output → processor` (fan-out tap) and
  `processor → zeroGain(0) → destination` so the processor runs without
  re-outputting audio. `onaudioprocess` copies channel 0 into a chunk list.
- On stop: assemble `take = { sampleRate, samples: Float32Array, duration }`.

## Modules

### `src/recorder.js`
- `concatChunks(chunks) → Float32Array` — pure; concatenates Float32 chunks.
- `createRecorder({ getSource, getContext }) → { start, stop, isRecording }`.
  - `start()`: builds the tap (no-op if no context/source); begins collecting.
  - `stop()`: returns `take | null` and tears down the tap nodes.

### `src/waveform.js`
- `computePeaks(samples, buckets) → Float32Array` — pure; max-abs amplitude per
  bucket (length `buckets`, values 0…1).
- `drawWaveform(canvas, samples, { color }) ` — draws a centered min/max-style
  waveform from peaks using `color` (lavender). Clears first.

### `src/track-lane.js` (extend)
- `renderTrackLane(container, { presetName, bars, takes = [] })`.
- For each take in `takes` (laid left-to-right, each starting where the previous
  ended), render a `.track-clip` positioned at `take.x` px with width
  `take.duration * PX_PER_SEC` (PX_PER_SEC derived so 1 bar = `BAR_W` at 120 BPM
  4/4 → `BAR_W / 2` px/sec). Each clip contains a `<canvas class="clip-wave">`
  (drawn via `drawWaveform`) and a `.clip-label` = `<preset> #<n>`.
- The clip is given its take so callers can draw after layout; the lane exposes
  the canvases by returning nothing — main.js draws via a returned list OR the
  lane draws immediately using the canvas size from CSS (fixed clip height). Use
  the latter: draw inside `renderTrackLane` after appending (canvas width set
  from computed clip width, height from CSS var).

### `src/main.js` (wire)
- `const recorder = createRecorder({ getSource: () => engine && engine.output, getContext: () => ctx })`.
- `let takes = []; let takeSeq = 0;`
- Record toggle on `#tp-record`: enabled only when live. Click → if not recording
  `recorder.start()` + button `.recording` (red pulse); else `const t = recorder.stop()`,
  push `{ ...t, n: ++takeSeq, name: activePresetName, x: <end of last take> }`,
  `renderTrack()`.
- `start()`: `$('tp-record').disabled = false`. `stop()`: stop any active
  recording, `$('tp-record').disabled = true`.
- `renderTrack()` passes `takes`.

## Colors (retained from GarageBand, theme-independent)

- Clip fill: `linear-gradient(180deg, #6361e6, #4f4cd0)`.
- Clip top border / header: `#8b8af0`.
- Waveform: `#d8daf8` (light lavender).
- Clip label text: `rgba(255,255,255,0.92)`.

## Testing

- `tests/recorder.test.js`: `concatChunks` joins chunks in order, total length,
  empty → length 0.
- `tests/waveform.test.js`: `computePeaks` returns `buckets` values; a full-scale
  sine → peaks ≈ 1; silence → peaks ≈ 0; bucket count math.
- `tests/track-lane.test.js` (extend): given `takes`, renders one `.track-clip`
  per take with the right `.clip-label` text and a `<canvas>`.
- Browser: START → record a few seconds (fake device) → a purple clip with a
  lavender waveform + `<preset> #1` appears; record again → `#2` appended; record
  disabled when stopped; no horizontal scroll regressions.
- Existing tests stay green (amp.test.js failures are pre-existing parallel work,
  out of scope).

## Out of Scope (later steps)

- Playback, moving playhead, transport play/stop, tempo-synced clip lengths,
  delete/drag clips, working mute/solo/monitor/volume/pan, stereo capture.
