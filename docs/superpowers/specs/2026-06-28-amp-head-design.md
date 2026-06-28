# Amp Head + Layout + Compact Tone Card — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** View layer. Re-present the amp-section effects as a GarageBand-style amp head;
re-lay-out the play surface; compact the tone card. No engine/DSP changes.

## Goals
1. **Amp head:** render the **Drive + EQ + Cabinet** modules as one premium amp-face panel
   with knobs (GarageBand Amp Designer look). These leave the pedalboard.
2. **Pedals below:** remaining true pedals (Compressor, Delay, Reverb, Chorus) stay as
   the pedalboard strip below.
3. **Layout:** play surface top row = **Guitar card (left) + Amp head (right)**;
   pedalboard full-width below.
4. **Compact tone card:** smaller radar + tight stat list → shorter card.

## Amp = which effects
`AMP_TYPES = {drive, eq, cabinet}` rendered in the amp head (in their chain order).
Everything else renders as pedals. Both drive the SAME engine params (schema-driven);
only the presentation changes. Param→engine index mapping is preserved (see wiring).

## Components

### `src/chain-ui/amp.js`
- `renderAmp(container, modules, onParamChange) → void`:
  - Clears container; builds an **amp chassis**: a **grille** zone (top, woven-cloth
    texture + a brand badge) and a **control panel** zone (brushed-metal strip).
  - For each module, a `.amp-section` in the panel: a small section label
    (`module.schema.label`) + a row of `createKnob`s for its params.
  - A knob change calls `onParamChange(moduleIndex, paramKey, value)` (index within the
    passed `modules` array — caller maps to the engine index).
- Reuses `createKnob` (same hardware knobs as the pedalboard).

### Wiring (`src/main.js` `loadPreset`)
Split `engine.modules` into amp vs pedal subsets, preserving each module's real engine
index, and render both with index-mapping callbacks:
```
const AMP_TYPES = new Set(['drive', 'eq', 'cabinet']);
const amp = [], ampIdx = [], ped = [], pedIdx = [];
engine.modules.forEach((m, i) => (AMP_TYPES.has(m.type) ? (amp.push(m), ampIdx.push(i)) : (ped.push(m), pedIdx.push(i))));
renderAmp($('amp'), amp, (j, k, v) => engine.setParam(ampIdx[j], k, v));
renderPedalboard($('chain'), ped, (j, k, v) => engine.setParam(pedIdx[j], k, v));
```
`renderPedalboard` signature unchanged (still uses its local array index; the mapping
callback handles the real index) — its tests stay valid.

### Layout (`index.html`)
- `.cards` row: Guitar card + a new `#amp` container (amp head). Two columns on wide,
  stack on narrow.
- Pedalboard strip below holds only the remaining pedals.

### Compact tone card (`src/profile-card/ui.js` + CSS)
- Reduce the radar SVG size; keep the 6 stats as a tight two-column list under it with
  less padding so the card is noticeably shorter. No logic change to stats/archetype.

## Amp visual (GarageBand-grade)
- **Grille:** dark woven-cloth look via layered CSS gradients (cross-hatch), subtle
  vignette, a small engraved **brand badge** (e.g. "GTR · STUDIO").
- **Control panel:** brushed-metal horizontal strip (linear gradient + faint vertical
  streaks), top + bottom hairline edges, screws.
- **Knobs:** the existing chrome knobs; section labels (DRIVE / EQ / CABINET) with thin
  dividers between sections.
- Light/dark theme aware; `prefers-reduced-motion` honored (inherited from knobs).

## Constraints
- No engine/DSP/param changes; no id removals. New ids: `#amp`.
- Keep `renderPedalboard`/`createKnob`/`valueToAngle` signatures.
- Full suite green; add a `renderAmp` test.

## Testing
- `tests/amp.test.js`: `renderAmp` builds a section per module, a knob per param, and a
  knob change fires `onParamChange(index, key, value)` (index within passed array).
- Existing tests unchanged. Visuals by eye (light + dark).

## Out of scope
- Changing effect order / which effects exist; amp on/off; cab IR.

## Success criteria
Drive+EQ+Cabinet show as one good-looking amp head (grille + metal panel + knobs) top-
right of the Guitar card; Compressor/Delay/Reverb/Chorus remain pedals below; tone card
is compact; all knobs drive the correct engine params; tests green.
