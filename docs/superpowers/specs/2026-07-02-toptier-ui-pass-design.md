# Top-Tier UI Pass — Design Spec

**Date:** 2026-07-02
**Maestro story:** ef666b43
**Status:** User-approved direction (from review conversation); NAM badge explicitly excluded.
**Baseline:** the WOW-backgrounds working-tree UI (dark charcoal, amber accents, macOS-style
window, brushed amp strip, skeuomorphic pedals) — to be committed before this pass begins.

## 1. Design language (governs every change)

**North star: GarageBand (Apple) hardware graphics** — user-stated. The current UI reads
flat/2D; this pass makes every device look physically real and touchable. Dimensionality
is the deliverable, not a nicety. All depth is *pre-rendered* (multi-stop gradients,
static shadows, gloss overlays) so it costs nothing at runtime.

- **One light source, top-left.** Every bevel, screw highlight, knob and glare obeys it.
- **Three depth planes:** board recess (darkest, inset) → device body (mid, raised) →
  controls (highest, specular). Each plane separated by a static drop shadow with real
  penumbra (two-layer shadows: tight dark + soft ambient) — GB devices visibly *sit on*
  the surface below them.
- **Curvature, not flatness:** enclosures get horizontal "bow" gradients (edge-dark →
  center-light → edge-dark) so bodies read as rounded metal boxes; panels get a vertical
  sheen; screens get a diagonal glass-gloss overlay (static ::before, low opacity).
- **Knobs are the hero control (GB signature):** deep-dish style — dark rubber/metal
  center, machined chrome ring (conic-gradient), strong top-light specular arc, crisp
  white position notch, tight elliptical contact shadow beneath. Must look grabbable.
- **Jewel lamps & switches:** glossy domed LEDs (radial highlight + colored core + rim),
  stomp switches as raised chrome discs with concentric rings.
- **Materials:** tolex (near-black micro-noise gradient), brushed aluminium (vertical
  1px striation gradients), grille cloth (woven repeating-gradient), cream/gold
  silkscreen labels, glass screens (existing pedal screen art stays bespoke per effect —
  memory rule).
- **Motion is autonomous and quiet:** LEDs, meters, a slow specular glint. No
  cursor-following, no traveling borders (user taste). All animation is
  **transform/opacity only, pre-rendered layers, no blur/filter/box-shadow animation**
  (perf rules — machine runs hot). `prefers-reduced-motion` disables glint + pulses.

## 2. Neural amp faceplates (the 5 Professional amps)

When the amp head contains a `neuralamp` module, the head group gets a per-model theme
class (`amp-face-jcm` … `amp-face-jc`). Pure CSS (gradients/patterns, no images):

| Model | Identity (abstracted, not trademarked) |
|---|---|
| jcm (Marshall JCM) | black tolex body, **gold brushed control panel**, white knob ticks |
| 5153 (EVH) | deep black panel, **ivory/blue stripe accent glow** along the top edge |
| deluxe (Fender Deluxe) | **blackface navy panel + silver-sparkle grille strip**, cream labels |
| ac10 (Vox AC10) | chocolate brown, **diamond-lattice grille** (CSS repeating-gradient), gold piping |
| jc (Roland JC) | **cool brushed silver**, thin blue accent line, solid-state cleanliness |

The model `<select>` becomes an engraved plate consistent with each theme. Analytic amp
keeps its brushed strip (polished per §6), so switching Professional ↔ analytic visibly
"swaps the amp."

## 3. Tube warm-up loading state

`neuralamp.js` dispatches `window` CustomEvents: `neural-amp-loading` (create/apply posts a
model) and `neural-amp-ready` / `neural-amp-error` (from the worklet's `ready`/`model-error`).
The amp head listens: while loading, a **pre-rendered amber glow layer + jewel lamp pulse
(opacity animation ~1.2s)**; on ready, lamp settles to steady green and the glow layer
fades out. Masks the model-load dry gap with intent instead of silence.

## 4. VU output meter (amp head)

A small SVG needle VU on the right of the amp strip (before REVERB group). Fed from the
**existing ~13 Hz meter loop** in `main.js` (no new rAF): needle angle = smoothed output
level, `transform: rotate()` with an ~80ms CSS transition for ballistics; peak LED via
opacity. Hidden when power is off.

## 5. Input channel meters (settings panel)

Two mini bars (CH1/CH2, ~40×4px) beside the Input-channel select, driven by two analysers
on the existing `inputSplitter` outputs, updated inside the same 13 Hz loop, **only while
the settings panel is open**. Solves "which channel is my guitar on" visually (the exact
problem the user hit).

## 6. Pedalboard + amp polish

- **Enclosure:** unified bevel per the light model; existing per-pedal colors/art kept.
- **Knobs:** richer radial metal gradient, crisp position notch (CSS only; knob.js API unchanged).
- **Active LED bloom:** pre-rendered glow layer toggled via opacity.
- **Footswitch press:** `transform: scale(.96)` 90ms micro-animation on toggle.
- **Autonomous glint:** a faint diagonal specular sweep (opacity ≤ .12) across each pedal
  every ~8s, staggered by index; single `::after`, translate-only.
- **Bypassed:** dimmed body + LED off via a static overlay (no filters).
- **Amp strip:** engraved section labels, hairline separators, tabular numerals on all
  readouts, "TUNE TO EDIT" as a proper chip button.

## 7. Explicitly out of scope

NAM badge (user declined), preset-browser redesign, track-lane changes, any change to the
audio graph beyond the two meter analysers + the neuralamp CustomEvents.

## 8. Files

`index.html` (CSS + settings-panel meter markup) · `src/chain-ui/amp.js` (faceplate class,
VU element, warm-up listener) · `src/chain-ui/pedalboard.js` (footswitch/glint hooks) ·
`src/effects/neuralamp.js` (CustomEvents) · `src/main.js` (meter-loop extension) · tests
(`tests/amp.test.js` updates + neuralamp event assertions).

## 9. Verification

Full vitest + e2e green. **Before/after screenshots of only the changed elements,
side-by-side** (Playwright), per the demo rule: amp head analytic, amp head ×2 neural
faceplates, one pedal close-up, settings-panel meters.
