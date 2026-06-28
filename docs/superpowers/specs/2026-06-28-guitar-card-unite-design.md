# Unite Guitar Card + Tone-Card Side Stats + Error Surfacing — Design

**Date:** 2026-06-28
**Status:** Approved
**Scope:** `index.html` + `src/profile-card/ui.js` + tiny `src/main.js` guard. No engine changes.

## Goals
1. **Unite** guitar controls (`#calibration`) + `#tone-card` into one **Guitar card** in the hero (controls top, tone card below).
2. **Tone card** restructured: name/archetype on top, then **radar (left) + stats as a vertical list (right)**.
3. Hero → 3 zones: `[note + status] · [spectrum (half) + volume] · [Guitar card]`.
4. **Error surfacing:** wrap `loadPreset`'s render in try/catch, write any error to `#error` (diagnose the "dropdown won't refresh knobs" report; code verified correct, suspected stale-cache).

## Changes
- `index.html`: hero markup — guitar zone becomes a `.card` with `h2` + `#calibration` + `#tone-card`; remove the standalone tone zone; hero 3-col grid; CSS for the united card + tone-card body row.
- `src/profile-card/ui.js` `renderProfileCard`: wrap the `<svg>` + `.tc-stats` in a `.tc-body` flex row; `.tc-stats` becomes a single-column list. Keep classes `.tc-name .tc-archetype svg .tc-stat` (ui test stays valid).
- `src/main.js` `loadPreset`: `try { renderAmp…; renderPedalboard… } catch (e) { $('error').textContent = 'render: ' + e.message; }`.

## Constraints
- Keep ids `#calibration #tone-card #note-circle #status #spectrum #gain`.
- `profile-card-ui.test.js` stays green (asserts svg + name + archetype + 6 `.tc-stat`).
- Full suite green.

## Success criteria
Guitar controls + tone card are one card; tone card shows radar beside a vertical stat list; hero is 3 balanced zones; any preset-load render error becomes visible; tests green.
