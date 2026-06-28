# Effect Cover Artwork — Design

**Date:** 2026-06-28
**Story:** maestro `1c9b714f`
**Status:** Approved direction (live-prototyped), pending spec sign-off

## Goal

Replace the "boring grayish blocks" in the effects UI with bespoke pedal-cover
artwork — like a real pedal line where every box has its own faceplate graphic.
Artwork appears in **two** places:

1. **Add Effect window** (`.fx-tile`) — a small cover thumbnail replaces the colored dot.
2. **Board pedals** (`.pedal`) — **full-bleed** cover art fills the whole enclosure;
   knobs, nameplate, LED, and footswitch sit on top.

All 23 addable effects get a cover. Amp modules (drive/eq/cabinet) are out of scope —
they live in the amp head, not as pedals.

## Art direction (agreed via live preview)

A single cohesive **screen-print / silk-screened stompbox** treatment, tuned per effect:

- **Sunburst/scene base** tinted by the effect's existing color (`--c`).
- **A bespoke motif** per effect that depicts what it *does* (see motif table).
- **Off-register ink** — the motif carries a deliberately misprinted color shadow
  (riso/screen-print artifact). This is the key tell that reads as *designed by a
  human*, not AI-smooth.
- **Paper grain** via SVG `feTurbulence` at low opacity.
- **Vignette** top+bottom so overlaid controls stay legible.

All art is **hand-coded inline SVG** — crisp at any size, recolorable via `--c`,
themeable, zero binary image assets.

### Pedal enclosure (agreed)

- **No colored top bar** (looked cheap). Replaced by a thin **anodized inner rim**:
  `inset` colored ring + faint inner glow hugging all four rounded corners.
- Art is **full-bleed** behind a readability **scrim** (transparent top → dark bottom).
- Nameplate sits bottom-center over the scrim; knobs below it; footswitch + LED at base.

### Per-effect nameplate font (matched to vibe)

Each effect *category* gets a font personality. Confirmed: **Fuzz → Bungee**.

| Family | Effects | Font | Vibe |
|---|---|---|---|
| Dirt | fuzz, boost, octave | **Bungee** | bold signage / vintage rock |
| Modulation | chorus, flanger, phaser, vibrato, tremolo, rotary, autopan | **Audiowide** | retro-futuristic groove |
| Time/Space | delay, reverb, pingpong, widener | **Orbitron** | spacey/ambient |
| Vintage time | tape-echo | **Special Elite** | typewriter/tape |
| Funk | wah, autowah | **Bungee Inline** | funky |
| Utility/tech | compressor, gate, limiter, pitchshift, looper, ringmod | **Major Mono Display** | technical mono |

Fonts load from **Google Fonts CDN** by extending the existing `<link>` in
`index.html:9` (the app already depends on the Google CDN for Inter + JetBrains Mono,
so this follows the established pattern — self-hosting would diverge for no gain).
A monospace system fallback in the `font-family` stack covers a CDN miss.

### Motif table

| Effect | Color | Motif |
|---|---|---|
| compressor | #0a84ff | waveform squeezed between two converging clamp bars |
| boost | #ff9500 | rising signal bars + upward burst / "+" |
| gate | #8e8e93 | portcullis gate; waveform chopped to silence (hard step) |
| fuzz | #ff453a | fat clipped square-wave + sunburst *(built)* |
| octave | #ff6482 | two stacked (octave-apart) clipped waves |
| wah | #ffd60a | rocker-pedal silhouette + sweeping resonant peak |
| autowah | #30d158 | envelope-triggered resonant sweep + auto loop arrow |
| chorus | #5ac8fa | 2–3 detuned, offset shimmering sine waves |
| flanger | #7d7aff | comb-filter jet-swoosh nested arcs |
| phaser | #bf5af2 | sweeping phase notches / interlocking S-curves |
| tremolo | #64d2ff | throbbing amplitude bars (volume pulsing) |
| vibrato | #40c8e0 | sinuous pitch-bending line |
| autopan | #00c7be | dot panning L↔R between two speakers |
| rotary | #a2845e | Leslie rotating-speaker horn with motion blur |
| ringmod | #ac8e68 | two multiplying carriers + metallic sidebands ring |
| delay | #ffd60a | fading echo repeats (decreasing bars) |
| tape-echo | #d4a017 | tape reels + warbled echo trail |
| pingpong | #ffc857 | echoes bouncing L/R, ping-pong path |
| reverb | #ff375f | concentric expanding ripples / cathedral space |
| widener | #5e5ce6 | arrows pushing stereo field outward L/R |
| limiter | #0a84ff | hard ceiling line clamping peaks flat |
| pitchshift | #ff2d55 | stepped pitch ladder / up-down note arrows |
| looper | #34c759 | circular loop/cycle arrows, layered |

## Architecture

New module **`src/chain-ui/fx-art.js`** — owns the art + font system, isolated from
pedalboard layout logic:

- `FX_ART_SHEET` — a single hidden `<svg>` sprite string: shared `<defs>` (grain
  filter, vignette/glow gradients) + one `<symbol id="fx-art-<type>" viewBox=... >`
  per effect. Symbols use `var(--c)` so they recolor from the host element.
- `FX_FONTS` — `{ [type]: { family, ls } }` map (letter-spacing per font).
- `ensureFxArtSheet()` — idempotently injects the sprite into `document.body` once.
- `fxArtSvg(type)` — returns an `<svg class="fx-art"><use href="#fx-art-<type>"/></svg>`
  element (or markup) for a given type.

**`index.html`** (CSS + fonts):
- `@font-face` for the 6 self-hosted families.
- `.pedal` rework: drop `border-top` color bar; add `.pedal-art` (full-bleed),
  `.pedal-scrim`, `.pedal-rim`, `.pedal-inner`; nameplate uses `font-family:var(--font)`.
- `.fx-tile` art sizing (`.fx-tile .fx-art{width:42px;height:30px}`); keep `.fx-tile-dot`
  rule as harmless fallback or remove.

**`src/chain-ui/pedalboard.js`**:
- `buildPedal()` — restructure to full-bleed art + overlay `.pedal-inner`; set `--c`
  and `--font`/`--font-ls` from `FX_FONTS`; call `ensureFxArtSheet()`.
- palette tile build — replace `.fx-tile-dot` span with `fxArtSvg(type)`; set `--font`.
- `makeGhost()` — optionally carry a mini art thumbnail (nice-to-have, not required).

## Data flow

`renderPedalboard` / `openEffectsModal` → `buildPedal` / tile loop → `ensureFxArtSheet()`
injects sprite once → each card/tile sets `--c` + `--font` and references the shared
`<symbol>` via `<use>`. No per-render SVG duplication; one sprite, N references.

## Testing

- Existing `tests/pedalboard.test.js` keys off `data-type` — unaffected.
- Add a test: every `PEDAL_TYPES` entry has a matching `<symbol>` in the sheet and a
  `FX_FONTS` entry (guards against adding an effect without art).
- Manual visual check via a preview harness (already prototyped for Fuzz).

## Out of scope (YAGNI)

- Amp-head module artwork.
- Animated/reactive covers (art is static SVG).
- User-customizable covers.
