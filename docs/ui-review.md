# UI Review — "does it look AI-made?" disposition

**Date:** 2026-07-03. Screenshot sweep: `shots/ui-review/` (37 captures — full
stage, toolbar, all 5 preset categories, tracks at two zooms, analytic + 4
neural amp faces, pedalboard + 6 pedal close-ups, fx picker, settings incl.
Come Together, tuner, both context menus, 1280 px width).

## Fixed this pass (the owner's flagged items + follow-ons)

1. **4 identical tubes on every amp** → tube complement now matches the amp:
   JCM/5153 quads, Studio/Deluxe/AC10 pairs, Roland JC solid-state (none).
2. **Neural face was TRIM/LEVEL only (toy-like)** → real Bass/Mid/Treble/
   Presence tone stack (audibly verified DSP, not decoration).
3. Earlier in the branch lineage: matched tube geometry (one cooler bottle),
   panel screws/wear/tolex history, per-effect knob hardware finishes, footswitch
   size/behavior, click-sparkle removal, song-named presets.

## Open findings (deferred, ranked; none block shipping)

| Sev | Area | Finding | Suggested fix |
|---|---|---|---|
| MED | Ruler right edge | zoom slider overlays the last bar numbers; at 1280 px it crowds | fade the ruler numbers under the control (mask-image) or dock the slider above the ruler line |
| MED | Empty timeline void | large dead area between tracks and the rig at tall viewports | subtle horizontal lane guides (GB draws faint row separators) |
| LOW | Context menus | flat panels next to skeuomorphic pedals read generic | reuse the tuner-strip material (border + inner highlight) |
| LOW | Preset browser rows | uniform weight/spacing, no per-category personality | small colored category glyphs before names |
| LOW | Settings sections | pure text; "Come Together" beta chip is the only accent | one-line icons per section header |
| LOW | Amp collapsed strip @1280 | value strip scrolls internally (works) but the cut "CABIN…" label suggests clipping | fade-out gradient at the scroll edge |

Next design pass can implement these directly from the screenshots.
