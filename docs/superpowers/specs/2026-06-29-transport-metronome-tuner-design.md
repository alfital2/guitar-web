# Transport + Metronome + Tuner — Design

Date: 2026-06-29

## Goal

Add a toolbar **transport cluster** (ground for upcoming recording), a working
**metronome** (with tempo control), and a high-precision **tuner**. Sets the
stage for recording without implementing it yet.

## Decisions (locked during brainstorming)

1. **Scope now:** metronome + tuner are fully functional; the transport buttons
   are visual ground (inert/disabled) until recording lands.
2. **Layout:** the centered "Guitar Studio" title is replaced by a centered
   transport cluster; metronome + tuner sit to its right. START/STOP/settings
   stay far right and keep their meaning (audio engine on/off).
3. **Metronome tempo:** scrub (drag/scroll) the BPM number to change it, and
   click the number to type a value. Plus an on/off toggle that flashes on beat.
4. **Tuner UI:** an inline strip in the toolbar (not an overlay).
5. **Tuner precision:** McLeod Pitch Method (NSDF) with parabolic interpolation
   for sub-cent accuracy; frame smoothing for stability.
6. **Tuner mic:** standalone — toggling the tuner grabs the mic on its own so you
   can tune before START; taps the existing analyser if the engine is live.
7. **Reference pitch:** A440 fixed (adjustable can come later).

## Toolbar Layout

Three regions in `.toolbar` (flex):

- **Center cluster** (replaces `.title`): transport + metronome + tuner.
  - Transport buttons, in image order: rewind ◀◀, fast-forward ▶▶,
    skip-to-start ⏮, play ▶, record ⏺ (red). All `disabled`, `title="available
    with recording"`, stable ids `#tp-rewind #tp-ffwd #tp-start #tp-play
    #tp-record`. Record uses a red dot; styled but inert.
  - Metronome controls (see below).
  - Tuner button + inline tuner strip (strip hidden until toggled on).
- **Right** (`.toolbar-actions`, unchanged): `#presets`, START, STOP, settings.

On narrow widths the cluster wraps below the actions (existing responsive
behavior); the tuner strip can hide under ~720px to save room.

## Metronome — `src/metronome.js`

Pure controller owning its own audio scheduling.

- `createMetronome({ onBeat } = {}) → { start, stop, toggle, setTempo, getTempo, isRunning }`
  - `start()` lazily creates/resumes an `AudioContext` (called from a user
    gesture, so autoplay policy is satisfied), starts the scheduler.
  - `stop()` halts the scheduler (keeps the context for reuse).
  - `setTempo(bpm)` clamps to **40–240**; default **120**.
  - `onBeat(beatIndex)` is invoked ~at audio time of each click (via a timed
    callback) so the UI can flash; `beatIndex % 4 === 0` is the accented beat.
- **Scheduler** (the "two clocks" pattern): a `setInterval(25 ms)` lookahead loop
  schedules every click whose time is within a 100 ms horizon. Each click is a
  short oscillator (≈ 1 kHz accent / 800 Hz normal) through a gain envelope
  (fast attack, ~40 ms decay). Timing is sample-accurate via
  `osc.start(time)` / `gain.gain.setTargetAtTime`.
- Pure helpers (unit-tested): `secondsPerBeat(bpm) = 60 / bpm`,
  `clampTempo(bpm) = max(40, min(240, round(bpm)))`. Exported.

### Metronome UI

- Toggle button `#metro-toggle` (icon ♩ / "METRO"); gets `.beat` class pulsed by
  `onBeat` (CSS flash, accented beat brighter).
- BPM readout `#metro-bpm` showing `"120"` + a "BPM" label.
  - **Scrub:** pointer drag (vertical) or wheel changes BPM (±1 per step; drag
    sensitivity ~ 1 bpm per 4px). `touch-action: none`.
  - **Click to type:** click swaps the readout for an `<input type="text"
    inputmode="numeric">` pre-filled with the current BPM and selected; Enter or
    blur commits via `clampTempo`, Esc cancels and restores.

## Tuner — `src/tuner.js`, `src/pitch/mpm.js`, `src/pitch/cents.js`

### `src/pitch/mpm.js` (pure detector)

`detectPitchMPM(buf, sampleRate, opts) → { freq, clarity } | null`

- `buf`: `Float32Array` time-domain window (e.g. 2048–4096 samples).
- Algorithm:
  1. Compute the **NSDF** (normalized square-difference function) for lags
     `0..n/2` (autocorrelation normalized by signal energy, range ≈ −1…1).
  2. Find the **key maxima**: zero-crossing-bounded positive peaks of NSDF.
  3. Pick the first peak whose value ≥ `k × globalMax` (k ≈ 0.9) — McLeod's
     octave-robust rule.
  4. **Parabolic interpolation** around that peak's lag → fractional lag `τ`.
  5. `freq = sampleRate / τ`; `clarity` = interpolated NSDF peak value (0…1).
- Returns `null` when the best clarity < `opts.threshold` (default 0.6) or no
  peak found (silence/noise → no reading).
- `opts`: `{ threshold = 0.6, minFreq = 50, maxFreq = 1500 }` (guitar range;
  bounds the lag search).

### `src/pitch/cents.js` (pure mapping)

`freqToCents(freq, a4 = 440) → { name, octave, cents, refFreq, midi }`

- `midi = round(69 + 12·log2(freq/a4))`; `refFreq = a4 · 2^((midi−69)/12)`;
  `cents = 1200 · log2(freq/refFreq)` (range about −50…+50).
- `name`/`octave` from midi (`['C','C#',…]`, octave = floor(midi/12) − 1).
- Examples (tested): 440→A4 0¢; 445→A4 ≈ +19.6¢; 82.41→E2 ≈ 0¢; 466.16→A#4 ≈ 0¢.

### `src/tuner.js` (controller)

`createTuner({ getLiveAnalyser, onReading, onState }) → { start, stop, isOn }`

- `start()`:
  - If `getLiveAnalyser()` returns an analyser (engine already running), use it.
  - Else acquire standalone: `getUserMedia({audio})` → `AudioContext` →
    `MediaStreamSource` → `AnalyserNode` (`fftSize = 4096`, no smoothing).
  - Begin a `requestAnimationFrame` loop: read float time-domain frame →
    `detectPitchMPM` → `freqToCents` → push to a short **median window** (5
    readings of cents+freq) → emit smoothed `onReading({ name, octave, cents,
    freq, clarity })` or `onReading(null)` when no pitch.
- `stop()`: cancel the loop; if standalone, stop the mic tracks and close the
  owned context. Never touches the engine's analyser/stream.
- `onState(on)` lets the UI reflect toggle + permission errors.

### Tuner UI (inline strip)

- Toggle button `#tuner-toggle`. When on, reveals `#tuner-strip`:
  - Note display `#tuner-note` (`E2`), big and monospace.
  - Cents meter: a fixed-width bar (−50…+50) with center tick + minor ticks and a
    needle `#tuner-needle` positioned by `cents`. Turns green within ±3¢.
  - Numeric `#tuner-cents` (`+0.4¢`) and `#tuner-hz` (`82.4 Hz`).
  - Idle/no-signal: note `—`, needle centered, dimmed.
- If mic permission is denied, the strip shows a short error and toggles off.

## main.js Wiring

- Build the toolbar cluster (markup in `index.html`; behavior wired in
  `src/main.js` or a small `src/transport-ui.js`).
- Metronome: `createMetronome({ onBeat })`; toggle button start/stop; BPM scrub +
  type → `setTempo`.
- Tuner: `createTuner({ getLiveAnalyser: () => analyser /* engine's, or null */,
  onReading, onState })`; toggle wires start/stop and shows/hides the strip.
- Transport buttons: present and `disabled`; no handlers yet.
- The engine's existing note display (hero) is unchanged; the tuner is separate
  and more precise.

## Testing

- `tests/mpm.test.js`: synthetic sine buffers at 82.41/110/146.83/220/440 Hz →
  detected within < 0.5 Hz; white noise / silence → `null`; a tone with a strong
  2nd harmonic still returns the fundamental (octave robustness).
- `tests/cents.test.js`: `freqToCents` known mappings (note name, octave, cents
  within 0.2¢).
- `tests/metronome.test.js`: `secondsPerBeat`, `clampTempo` (40/240 bounds,
  rounding); `createMetronome` tempo get/set without audio (guard when no
  `AudioContext` — controller still tracks tempo/running state).
- Browser verification: metronome audible + on-beat flash + scrub/type; tuner
  standalone mic, note/cents/Hz update, in-tune lock, mic released on toggle off;
  transport buttons inert; no horizontal scroll; responsive.
- All existing tests stay green.

## Out of Scope (YAGNI)

- Recording / playback (transport buttons are inert ground only).
- Adjustable reference pitch, alternate tunings, strobe display.
- Metronome time signatures / subdivisions beyond a 4-beat accent.
