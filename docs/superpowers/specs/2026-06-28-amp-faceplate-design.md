# Amp Faceplate Redesign + Guitar-to-Top Layout — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** View layer only. No engine/DSP/param changes; tests stay green.

## Goals
1. Move the **Guitar section** (picker + strength + tone card) to a full-width strip
   directly under the hero ("guitar at top").
2. Make the **amp** a full-width, premium **amp-head faceplate** (the current one is
   ugly: empty grille, washed panel, cramped/uneven sections).

## Layout (`index.html`)
- Hero unchanged (note circle + spectrum + volume).
- **Guitar strip** (full width, under hero): a row — left = `#calibration`
  (picker + strength); right = `#tone-card` (compact). Stacks on narrow.
- **Amp** full width below the guitar strip (`#amp`).
- **Pedalboard** strip below.
- Remove the old two-column `.cards` row (Guitar + Amp side-by-side).

## Amp faceplate (`amp.js` minor + CSS)
- Structure: keep `.amp` → `.amp-grille` (now a **thin top tolex strip** holding the
  brand badge + a **power LED**) → `.amp-panel` (the **faceplate**) → `.amp-section`s.
- `amp.js`: add an `.amp-led` element to the grille; otherwise unchanged.
- Faceplate look: dark tolex shell, **brushed-metal control plate** (subtle metal
  gradient + faint vertical streaks), full width; sections **Drive · EQ · Cabinet**
  spread evenly across the width (`justify-content: space-around`, sections size to
  content) so there is **no dead space**; thin dividers between sections; **white
  silkscreen** section labels with a short underline/bracket; knob value/label text
  white for contrast on metal.
- Brand badge + amber power LED top-left/right. Chrome knobs (existing). Premium,
  balanced — Fender/Marshall head vibe.

## Constraints
- No id removals; keep `#amp #calibration #tone-card #chain #presets`.
- Keep `renderAmp`/`renderPedalboard`/`createKnob` signatures; `amp.test.js` still
  passes (asserts grille/panel/sections/knobs — LED addition is additive).
- Theme-aware where the app chrome is; amp stays hardware-metal in both themes.

## Testing
- `amp.test.js` unchanged passes. Full suite green. Visuals by eye (light + dark, wide
  + narrow).

## Out of scope
- Changing effects/params; amp on/off; tone-card internals.

## Success criteria
Guitar section sits as a full-width strip under the hero; the amp is a full-width,
evenly-laid-out, good-looking amp-head faceplate with no empty gaps; everything still
drives the right params; tests green.
