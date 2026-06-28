# Pedalboard Glow-Up + Guitar Card Merge — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** Pure visual polish. CSS + `knob.js` SVG only. No engine/DSP/logic changes;
no element-id changes; tests stay green (they assert aria/onChange, not pixels).

## Goals
1. Merge the **Guitar** and **Tone Card** cards into one card.
2. Make the **pedalboard** look GarageBand-grade: real-feeling rotary knobs + premium
   pedal chassis.

## 1. Merge cards
The two play cards (`#calibration` controls and `#tone-card`) become one **"Guitar"**
card: picker + strength on top, the tone-card radar below. `index.html` only.

## 2. Knob upgrade (`src/chain-ui/knob.js` SVG + CSS)
Replace the flat arc+line with a layered dial (all SVG, sized in the existing 56×56
viewBox; tests unaffected):
- **Cap:** filled circle with a per-knob `radialGradient` (light top-left → dark
  bottom) + a thin beveled ring stroke; a soft drop shadow (SVG filter or CSS).
- **Tick marks:** a ring of short ticks around the dial (e.g. 11 ticks across the 270°
  sweep), drawn as small lines in `--line`.
- **Value arc:** outer accent arc from start to current angle, with a soft glow
  (`filter: drop-shadow` / blur) — keeps `valueToAngle` as-is.
- **Indicator:** a notch/line on the cap pointing to the current angle (the existing
  pointer, restyled brighter).
- **Drag state:** `.knob.dragging` lifts the cap slightly (scale) + brightens the arc
  glow. Respect `prefers-reduced-motion`.
- Unique gradient/filter ids per knob instance (counter) so multiple knobs don't clash.

## 3. Pedal chassis upgrade (CSS in `index.html`)
- **Depth:** vertical chassis gradient (subtle), inset top highlight + stronger bottom
  drop shadow → reads as a 3D box, not a flat panel. Theme-aware via existing vars.
- **Name plate:** engraved look (darker inset strip with a faint inner shadow + light
  top edge) behind the effect name.
- **Footswitch + LED:** a faux footswitch bar and a small LED dot near the bottom of
  each pedal (cosmetic), LED tinted with the pedal's hue.
- Keep the per-type hue top accent and the `→` connectors.

## Constraints
- No id changes; keep `valueToAngle`/`createKnob`/`renderPedalboard` signatures.
- All theme-aware (light + dark) using existing CSS variables; `prefers-reduced-motion`
  honored for the drag/lift animation.
- No new dependencies.

## Testing
- Existing `knob.test.js` / `pedalboard.test.js` stay green (behavior unchanged).
- Visual quality verified by eye in Chrome, light + dark.

## Out of scope
- Changing knob interaction, params, layout order, or any DSP.
- Real bitmap textures/images (use CSS gradients/SVG only).

## Success criteria
The pedalboard reads like a premium hardware pedalboard (dimensional pedals, hardware
knobs with ticks + glow), the Guitar/Tone-Card merge removes a card, everything stays
theme-aware, and all tests remain green.
