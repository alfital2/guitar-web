# Hero Four-Zone Layout — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** `index.html` markup + CSS only. No JS/engine changes; ids preserved; tests green.

## Goal
Pack the hero into one tidy row of four compact zones, narrower spectrum, tone card in the hero.

## Layout (`index.html`)
Hero grid = 4 columns:
1. **Note + status** — note circle stacked over status, narrow/compact (less space).
2. **Guitar** — `#calibration` (picker + strength).
3. **Viz** — `#spectrum` at ~half its old width (constrained column) + shorter, with the volume slider.
4. **Tone card** — `#tone-card` moved into the hero (remove the separate `.tone-strip` section).

`@media (max-width: 900px)`: zones stack to 1 column.

## Sizes
- Note circle ~62px; `.hero-note` becomes a compact vertical stack (note above status).
- Spectrum column constrained (~`minmax(150px, 1fr)`); canvas height ~110px.
- Tone card column ~240–300px; tone card stays compact (existing small radar).

## Constraints
- Keep ids `#note-circle #status #status-dot #calibration #spectrum #gain #tone-card`.
- No engine/JS change; `renderProfileCard` renders into the relocated `#tone-card`.
- Full suite green; visuals by eye.

## Success criteria
Hero is a single balanced row — compact note/status, guitar controls, half-width spectrum, and the tone card — no separate tone strip; stacks on narrow; tests green.
