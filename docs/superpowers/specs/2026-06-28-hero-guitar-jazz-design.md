# Guitar-in-Hero + Compact Tone Card + Jazz-Club Dark Theme — Design

**Date:** 2026-06-28
**Status:** Approved, ready for plan
**Scope:** `index.html` only (markup + CSS). No JS/engine changes; ids preserved; tests green.

## Goals
1. **Note circle** smaller.
2. **Guitar controls** (`#calibration` = picker + strength) move into the **hero** as a
   compact middle zone (not a wide separate card).
3. **Tone card** becomes a small, content-sized card under the hero (kill the wasted
   wide empty card).
4. **Dark theme** gets a GarageBand-style **jazz-club backdrop** (pure CSS, no
   instruments): brick wall + warm wood floor + spotlight + vignette + faint neon glow,
   behind the floating window. Light theme unchanged.

## Layout (`index.html`)
- Hero grid → **three zones**: `[note circle (small) + status] · [Guitar: label + #calibration] · [spectrum + volume]`.
- After hero: a **tone strip** holding `#tone-card`, max-width ~440px, left-aligned.
- Remove the old `.guitar-strip` / `.amp`-in-cards block (guitar now in hero; amp strip
  already full-width below — unchanged).
- Narrow (<720px): hero zones stack.

## Sizes
- `.note-circle`: ~72px (from 118), font ~26px.
- Hero guitar zone width ~200–260px.

## Dark-theme jazz-club backdrop (`:root[data-theme="dark"] body`)
Layered CSS background (no images), `background-attachment: fixed`:
- **Spotlight:** top radial warm glow.
- **Brick wall:** mortar grid via two repeating-linear-gradients over a warm-dark base.
- **Wood floor:** a wood-plank gradient band across the bottom ~20%.
- **Vignette:** radial darkening at edges.
- **Neon accent:** a faint blue radial glow (top-left) for the "JAZZ sign" hint.
Window keeps its own `--bg` so it floats on the club backdrop. Light theme: keep the
current clean `--desktop` background.

## Constraints
- Keep ids `#calibration #tone-card #note-circle #status #spectrum #gain #amp #chain #presets`.
- No engine/JS changes; `renderCalibrationControls`/`renderProfileCard` render into the
  relocated containers unchanged.
- Full suite green; visuals by eye (dark + light, wide + narrow).

## Success criteria
Note circle small; guitar picker+strength live in the hero; tone card is a small card,
no wasted space; dark theme reads like a jazz-club stage backdrop (brick/wood/spotlight)
without instruments; light theme unchanged; tests green.
