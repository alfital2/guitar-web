# Settings Slide-In Panel — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** View-layer IA change. Move setup-only controls into a slide-in Settings
panel; keep the play surface focused. No engine/DSP changes.

## Problem

Device pickers, latency diagnostics, hints, and "Calibrate New Guitar" are always on
screen but are setup tasks, not play-time controls. Clutters the play surface.

## Mechanism (locked)

A **⚙ gear button** in the toolbar toggles a **slide-in panel from the right**
(over the content, with a dim backdrop). Close via: gear again, the panel's close
button, `Esc`, or clicking the backdrop.

## Content split

**Play view (always visible):**
- Hero (note circle, spectrum, volume) — unchanged.
- **Guitar card:** active-guitar picker + calibration **strength** slider.
- **Tone Card** card — unchanged.
- **Pedalboard** strip (preset + bricks) — unchanged.

**Settings panel (slide-in):**
- **Devices:** input/output selects, Focusrite tip, Safari warning, error line.
- **Diagnostics:** input level meter + latency stats (sample rate / base / output /
  round trip / verdict).
- **Calibration setup:** "Calibrate New Guitar" button + the capture wizard
  (countdown, coverage bar, save/cancel).

## Component changes

- `src/calibration/ui.js` `renderCalibrationControls(container, state, handlers)`:
  render **only** the guitar picker + strength slider (drop the Calibrate button).
  Handlers shrink to `{ onSelect, onStrength }`. Update its test.
- `index.html`:
  - Toolbar: add `#settings-toggle` (⚙) button.
  - Add `#settings-backdrop` and `#settings-panel` (right slide-in) containing a header
    (title + `#settings-close`), the Devices section, the Diagnostics section, and the
    Calibration-setup section (a `#calib-start` button + `#calib-wizard`).
  - Play cards become: **Guitar** card (`#calibration`) + **Tone Card** (`#tone-card`).
  - Move Devices/diagnostics ids into the panel: `input, output, error, safari-warn,
    meter, sr, base, out, total, verdict, diag`.
  - CSS: panel `transform: translateX(100%)` → `0` when `.open`; backdrop fade;
    respect `prefers-reduced-motion`.
- `src/main.js`:
  - Wire `#settings-toggle` / `#settings-close` / backdrop / `Esc` to toggle
    `.open` on the panel + backdrop.
  - Call `renderCalibrationControls` with `{ onSelect, onStrength }` only.
  - Wire `#calib-start` → `startCalibration()` (replacing the old `onCalibrate`).

## Element-ID contract

Keep all existing ids: `input, output, start, stop, gain, status, status-dot, diag,
error, safari-warn, note-circle, spectrum, meter, sr, base, out, total, verdict,
calibration, calib-wizard, calib-instr, calib-coverage, calib-save, calib-cancel,
presets, chain, tone-card, theme-toggle`. New ids: `settings-toggle, settings-panel,
settings-backdrop, settings-close, calib-start`.

## Testing

- `renderCalibrationControls` test: now asserts picker + strength render and fire
  `onSelect`/`onStrength`; no Calibrate button (button lives in settings markup).
- Settings open/close is DOM glue — verified by eye.
- Full suite stays green.

## Out of scope
- Play/Settings as persistent tabs (chose slide-in panel instead).
- Reorganizing pedalboard or hero.

## Success criteria
Play surface shows only play controls. Gear opens a right slide-in Settings panel with
Devices + diagnostics + Calibrate New Guitar; Esc/backdrop/close dismiss it. Calibration
strength + guitar picker remain on the play surface. All functionality intact; tests green.
