# Pedalboard + Rotary Knobs — Design

**Date:** 2026-06-28
**Status:** Approved, ready for implementation plan
**Scope:** Replace the slider-list "Signal Chain" with a GarageBand-style **pedalboard**
of effect **bricks** with **rotary knobs**. View layer only — no engine/DSP changes.

## Vision

The signal chain should read as a **pedalboard**, not a settings list: each effect is a
hardware **brick** with real **rotary knobs**, laid out left→right in signal order with
connector arrows, in a full-width strip. Stays fully schema-driven (no per-effect code).

## Interaction (locked)

Knobs use the pro standard: **vertical drag** (up = increase), **mouse wheel**,
**arrow keys** when focused (Page/▲▼ nudge), **double-click = reset to default**.
Accessible: `role="slider"`, `aria-valuemin/valuemax/valuenow/valuetext`, `tabindex=0`,
focus ring.

## Components

### `src/chain-ui/knob.js`
- `valueToAngle(value, min, max, startDeg = -135, endDeg = 135) → number` — **pure**,
  maps a value to the dial angle over a 270° sweep; clamps out-of-range.
- `createKnob(param, value, onChange) → { el, setValue }`:
  - `param` = a schema param `{key,label,min,max,default,step,unit?}`.
  - Builds a focusable element (`role="slider"`) containing an SVG dial: background
    track arc, accent **value arc**, a pointer, and below it the **value readout**
    (formatted with unit) and the **label**.
  - Interaction: pointer drag (vertical; sensitivity ≈ full range over ~150px),
    `wheel` (±step), keydown (`ArrowUp/Right` +step, `ArrowDown/Left` −step,
    `PageUp/Down` ±10·step), `dblclick` → `param.default`. All clamp to [min,max] and
    snap to `step`; each change calls `onChange(newValue)` and updates the dial + aria.
  - `setValue(v)` repaints arc/pointer/readout/aria.
- Value formatting: integer steps → integer; fractional steps → trimmed decimals;
  append `unit` when present (e.g. `320 ms`, `0.65`, `-18 dB`).

### `src/chain-ui/pedalboard.js`
- `renderPedalboard(container, modules, onParamChange) → void`:
  - Clears `container`; for each `module` (index `i`) renders a **brick**:
    a `.pedal` panel with a **name plate** header (`module.schema.label`) and a
    `.knobs` row holding one `createKnob` per `module.schema.params`, wired so a knob
    change calls `onParamChange(i, param.key, value)`.
  - Inserts a `.connector` (→) between consecutive bricks.
  - Per-effect **accent hue** on the brick's top bar / name plate (a fixed hue per
    effect `type`, e.g. compressor/drive/eq/cabinet/delay/reverb/chorus each get a
    distinct tasteful hue), body stays neutral + theme-aware.

## Layout

- `index.html`: remove the **Signal Chain** half-width card; add a **full-width
  `<section class="pedalboard-strip">`** below the cards grid (inside `.window`),
  containing a header row with the **preset picker** (`#presets`) and the bricks
  container (`#chain`). Bricks flow left→right and wrap; horizontal scroll if a single
  row overflows on a narrow window.

## Styling

- Brick: rounded raised panel (subtle elevation + hairline), top accent bar in the
  effect's hue, a "name plate" label, faint corner screw dots — hardware feel, not
  kitsch; fully light/dark aware via existing CSS variables.
- Knob: ~64px dial; track arc in `--line`, value arc + pointer in `--accent`; readout
  in `--text`, label in `--muted`; hover/focus ring; value brightens while dragging
  (`.knob.dragging`). Respect `prefers-reduced-motion`.

## Wiring

- `src/main.js`: import `renderPedalboard`; call `renderPedalboard($('chain'), engine.modules, (i,k,v) => engine.setParam(i,k,v))` where it currently calls `renderChain`. `renderPresetPicker` (from `ui.js`) unchanged.
- `src/ui.js`: **remove** `renderChain` (superseded); keep `renderPresetPicker`.

## Testing

- `valueToAngle` (pure): min→startDeg, max→endDeg, midpoint→0°, out-of-range clamps.
- `createKnob` (jsdom): `ArrowUp` raises value and fires `onChange` with the snapped,
  clamped value; `dblclick` resets to default; `setValue` updates `aria-valuenow`.
- `renderPedalboard` (jsdom): renders one `.pedal` per module, one knob per param,
  connectors between bricks; a knob change calls `onParamChange(index, key, value)`.
- `tests/ui.test.js`: drop the `renderChain` slider cases (function removed); keep
  `renderPresetPicker` cases.
- Full suite stays green. Feel (drag precision, aesthetics) verified by eye in Chrome.

## Out of scope
- Drag-to-reorder pedals; add/remove pedals from the UI (presets still define the chain).
- Bypass/on-off footswitch per pedal (possible later).
- Changing any effect parameters, ranges, or DSP.

## Success criteria
The chain renders as a pedalboard of hardware-style bricks with turnable rotary knobs
(vertical drag/keyboard/wheel/double-click-reset), in signal order with connectors,
full-width, theme-aware, accessible — and it drives the engine exactly as the sliders
did. Tests green.
