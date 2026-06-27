# Generic Guitar Effects Engine + Artist Presets — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation plan
**Builds on:** `2026-06-27-latency-test-poc-design.md` (latency validated in Chrome ~20ms, feels real-time)

## Vision

A **generic, composable guitar effects engine** in the browser — not a hardcoded
amp sound. The guitar signal flows through a configurable chain of reusable,
tunable effect blocks. **Artist/song presets are just named configurations** of
those blocks ("John Mayer — Edge of Breakup" is really `compressor → drive → eq →
cabinet → delay → reverb` with specific values). The preset is an abstraction over
the chain; the chain underneath stays fully visible and editable.

Presets are **data, not code**. Adding a new artist = research + one JSON file.

**Target browser:** Chrome/Chromium (best Web Audio latency; Safari is a
higher-latency fallback — see latency POC findings).

## Architecture

Four cleanly separated concerns:

1. **Engine** (`engine.js`) — reads a chain description (array of effect configs),
   instantiates the corresponding effect modules, wires the Web Audio graph
   `input → fx → fx → … → output`, and exposes live parameter updates. Knows
   nothing about specific effects beyond their common interface.
2. **Effects library** (`effects/*.js`) — one module per block type. Each exports:
   - a **param schema** (name, label, min, max, default, step, unit) — drives the UI
   - a **factory** that builds its Web Audio node(s) for a given `AudioContext`
   - **`apply(params)`** to update parameters live
   - **`input` / `output`** node handles for chaining
3. **Presets** (`presets/*.json`) — pure JSON: `{ name, artist, song?, chain: [...] }`.
4. **UI** (`ui.js`) — auto-renders controls from each block's param schema (a new
   effect needs zero UI code). Two layers: pick a preset → expand to tweak blocks.
   Plus device I/O reused from the latency POC.

The audio I/O shell (`index.html`) reuses the latency POC's getUserMedia setup
(echoCancellation/noiseSuppression/autoGainControl OFF, `latencyHint: 'interactive'`,
`latency: 0`, Focusrite in/out, setSinkId where supported).

### Common effect-module interface

```js
export const schema = { type: 'drive', label: 'Drive',
  params: [ { key: 'amount', label: 'Amount', min: 0, max: 10, default: 2.5, step: 0.1 }, ... ] };
export function create(ctx, params) {
  // build nodes; return { input, output, apply(params) }
}
```

The engine treats every block identically through `{ input, output, apply }`.

## Effects library (v1)

All file-free — no external impulse-response assets.

| Block | Web Audio implementation | Params |
|---|---|---|
| **compressor** | `DynamicsCompressorNode` | threshold, ratio, attack, release, makeup |
| **drive** | `WaveShaperNode` (asymmetric soft-clip curve, `oversample:'4x'`) with a parallel **clean blend** path; optional pre-clip mid-bump + low-cut for TS mode | amount, tone, level, blend, midBump |
| **eq** | `BiquadFilter` ×3: low-shelf, peaking (mid), high-shelf | bass, mid, midFreq, treble |
| **cabinet** | filter-based emulation: high-pass ~80 Hz → peaking boost ~2.5 kHz → steep low-pass ~5 kHz (12/24 dB) | brightness, body, mix |
| **delay** | `DelayNode` + feedback `GainNode` + damping `BiquadFilter` (low-pass) in the feedback loop; wet/dry mix | time (ms), feedback, tone, mix |
| **reverb** | `ConvolverNode` with a **code-synthesized impulse** (exponentially-decaying filtered noise generated at runtime); wet/dry mix | size/decay, mix |

**IR-ready:** cabinet and reverb are isolated behind the standard module interface,
so swapping to real impulse-response convolution later is a module-internal change
with no impact on engine, presets, or UI.

### Wet/dry handling

Time-based and parallel blocks (drive blend, delay, reverb, cabinet mix) manage
their own internal dry/wet split so the engine can keep chaining blocks in simple
series via `input`/`output`.

## Preset format

```json
{
  "name": "Mayer — Edge of Breakup",
  "artist": "John Mayer",
  "song": "Slow Dancing in a Burning Room",
  "chain": [
    { "type": "compressor", "params": { "ratio": 2.5, "threshold": -18, "attack": 0.005, "release": 0.25, "makeup": 3 } },
    { "type": "drive",      "params": { "amount": 2.5, "blend": 0.65, "tone": 5, "level": 5 } },
    { "type": "eq",         "params": { "bass": 3, "mid": 4, "midFreq": 750, "treble": 1 } },
    { "type": "cabinet",    "params": { "brightness": 4, "body": 6, "mix": 1 } },
    { "type": "delay",      "params": { "time": 320, "feedback": 0.2, "tone": 4, "mix": 0.15 } },
    { "type": "reverb",     "params": { "size": 0.5, "mix": 0.12 } }
  ]
}
```

- Loading a preset rebuilds the chain; all values stay editable in the UI.
- User edits can be saved as new presets to `localStorage` (v1) — no backend.

## v1 deliverable (proof)

- Full engine + all 6 effect blocks.
- **Two** John Mayer presets, proving preset-switching and that a new tone is just
  data, not code:
  - **Mayer — Edge of Breakup** (signature dynamic clean/breakup; values above)
  - **Mayer — Lead Boost** (Tone B: second drive stage with mid-hump, gain ~4-5,
    low-cut ~720 Hz, output boost; more delay feedback/mix)
- A "clean / bypass" preset (empty or minimal chain) as a reference.
- UI: preset picker → expandable chain view with live knobs → input meter (reused).

## John Mayer tone targets (from research)

The 3 things that make it recognizable, to verify by ear:
1. **Touch-sensitive edge-of-breakup** — low drive + asymmetric soft clip, not
   over-compressed, responsive to pick attack. Most important.
2. **Warm, mid-present, never harsh** — mids kept up (not deep-scooped), highs
   rolled off via cab low-pass ~5 kHz + tamed presence.
3. **Subtle dark delay + spring-ish reverb underneath** — low mix, dark repeats.

Reference settings synthesized in research report (Klon ~11 o'clock gain/output,
Two-Rock "Slow Dancing": Bass 5 / Mid 6 / Treble 6 / Gain 4 / Reverb 3 / Presence 4).

## Out of scope (later phases)

- Real cabinet/reverb IR files
- Additional artists (Tim Henson, Mateus Asato) — research + JSON each
- Per-song preset library at scale
- Recording / backing tracks / looping
- Drag-to-reorder chain, add/remove blocks in UI (v1 presets define the chain)
- Tuner, metronome
- Backend / preset sharing / accounts

## Success criteria

In Chrome: load "Mayer — Edge of Breakup," play, and it credibly evokes the Mayer
tone (touch-sensitive, warm, ambient). Switch to "Lead Boost" and hear a distinct,
fuller lead voicing. Expand the chain and tweak any knob live. Confirms the generic
engine + preset-abstraction works end-to-end.
