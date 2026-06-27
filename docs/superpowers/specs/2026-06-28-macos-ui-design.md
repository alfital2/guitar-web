# macOS-Style UI Overhaul — Design

**Date:** 2026-06-28
**Status:** Approved, ready for implementation plan
**Scope:** View layer only — `index.html` (markup + CSS) and presentational additions
to `src/main.js`. No engine/effects/calibration/pitch/preset logic changes. The 85
existing tests stay green; one small pure helper (`resolveTheme`) gets a test.

## Vision

Make the app look and feel like a **native macOS application** — window chrome,
vibrancy materials, SF Pro type, native-style controls, fluid spring motion,
responsive — built on a **hero + cards** layout. Explicitly **not** a generic
web/AI landing page.

### Anti-goals (must avoid)
- No giant marketing gradient hero; no purple/indigo gradient blobs.
- No emoji used as UI icons; no center-aligned landing-page copy.
- No oversized/overdone glassmorphism; vibrancy is subtle and purposeful.
- No heavy borders — hairline separators like AppKit.
- App density and hierarchy, not "stack of settings rows."

## Layout (hero + cards, in a window shell)

```
┌───────────────────────────────────────────────┐
│ ●●●   Guitar Studio          [Start] [◐ theme] │  ← unified toolbar (vibrancy)
├───────────────────────────────────────────────┤
│   HERO: ⬡ note circle   |  live spectrum        │
│         active preset    |  master volume        │
├───────────────────────────────────────────────┤
│  ┌ Devices ┐ ┌ Calibration ┐                    │
│  ┌ Tone Card ┐ ┌ Signal Chain ┐                 │  ← responsive card grid
└───────────────────────────────────────────────┘
```

- **Window shell:** rounded-corner container, max-width centered, soft outer shadow;
  on a narrow viewport it fills width and cards collapse to one column.
- **Toolbar:** traffic-light dots (cosmetic), centered title, right-side transport
  (Start/Stop) + theme toggle. Translucent blurred background (`backdrop-filter`).

## Theme system (follow system + override)

- `resolveTheme(systemPrefersDark: boolean, override: 'light'|'dark'|null) → 'light'|'dark'`
  — pure: returns `override` if set, else system preference. **Unit tested.**
- On load: read override from `localStorage('ui-theme')`, read `matchMedia('(prefers-color-scheme: dark)')`, apply `data-theme` on `<html>`. Listen to `matchMedia` changes (when no override). Toolbar toggle cycles override and persists.
- All colors via CSS custom properties with `:root[data-theme="dark"]` / `["light"]`
  blocks. macOS-ish palette: true grays, hairline separators, one accent (the
  existing guitar-orange `--accent`), distinct elevated-surface vs window-background.
- Smooth color transition on theme change (short cross-fade on backgrounds/borders).

## Hero — "Now Playing"

- **Note circle:** the existing `#note-circle`, enlarged, with a spring pop + subtle
  pulse on note change (CSS transform/opacity; driven by the existing detection — add
  an `active` flash). Still shows `—` when idle.
- **Active preset name:** large secondary title, updates on preset change.
- **Live spectrum analyzer:** a `<canvas id="spectrum">` drawn each rAF frame from
  `analyser.getByteFrequencyData` — a row of bars (log-ish grouping) reacting to
  playing, in the accent color with a soft falloff. The interactive centerpiece.
  Read-only (uses the existing analyser tap).
- **Master volume:** the existing `#gain` slider, restyled.

## Cards

Responsive CSS grid (2-up on wide, 1-up on narrow). Each card: elevated surface,
hairline border, rounded corners, a small section header, inset content. Cards:
- **Devices** — input/output pop-up menus, status line, diag, Focusrite/Safari hints.
- **Calibration** — profile picker, strength slider, Calibrate button, wizard
  (countdown, coverage bar, save/cancel).
- **Tone Card** — the SVG radar (unchanged internals).
- **Signal Chain** — preset pop-up + the auto-rendered effect knobs.

## Controls → native macOS styling

- `<select>` → macOS pop-up menu look (custom chevron, inset, hairline).
- `input[type=range]` → macOS track + thumb (thin track, round thumb, accent fill).
- Buttons → push-button (secondary) and filled-accent (primary, e.g. Start);
  `:hover`/`:active`/`:focus-visible` states with AppKit-like focus ring.
- Theme toggle → a real switch/segmented control.
- The schema-driven chain knobs and calibration controls inherit these styles (their
  render functions are unchanged; styling is by element type + container class).

## Type & motion

- System font stack (`-apple-system, "SF Pro Text"…`), Apple-ish type scale: large
  title (toolbar/hero), headline (card headers), body, caption (secondary labels).
- Motion: spring/ease transitions on hover lift, button press, note pop, coverage
  fill, theme cross-fade. Respect `prefers-reduced-motion` (disable non-essential
  animation). Restrained — no gratuitous movement.

## Element-ID contract (must preserve)

The markup restructure MUST keep every id `main.js` uses, or wiring breaks:
`input, output, start, stop, gain, status, status-dot, diag, error, safari-warn,
note-circle, meter, sr, base, out, total, verdict, calibration, calib-wizard,
calib-instr, calib-coverage, calib-save, calib-cancel, presets, chain, tone-card`.
New ids: `theme-toggle`, `spectrum`.

## Implementation & testing

- `index.html`: rewritten markup (window/toolbar/hero/cards) + new CSS; keep all ids.
- `src/main.js`: add `resolveTheme`, theme init + toggle handler, and a
  `drawSpectrum()` call folded into the existing meter rAF loop (uses `analyser`).
- `src/theme.js` (new, pure): export `resolveTheme`.
- Tests: `tests/theme.test.js` for `resolveTheme`; everything else unchanged; full
  suite green. Visual quality verified by eye in Chrome (light + dark).

## Out of scope
- New features/effects; changing any DSP or preset values.
- Real SF Symbols icon set (use minimal inline SVG/CSS glyphs where needed).
- Multi-window / actual native packaging.

## Success criteria
In Chrome: the app reads as a polished macOS application — window chrome, vibrancy,
native controls, a live reacting spectrum, light/dark following the system with a
working override toggle, responsive to window size — and clearly not a generic
website. All existing functionality intact; tests green.
