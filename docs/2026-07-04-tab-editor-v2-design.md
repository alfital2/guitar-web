# Tab Editor v2 — Design

**Date:** 2026-07-04 · **Status:** approved (brainstorm) · **Story:** maestro `0c3b8cf0`

## Purpose

Guitar teachers author licks/exercises in the app and share them as files;
students open them and practice. Transcription (right-click clip → Transcribe)
remains a *seeder* — the editor must stand alone as a fast, keyboard-friendly
composer. Scale target: licks/exercises, 1–16 bars.

## Goals

1. Add/delete notes by mouse and keyboard — compose from an empty lane.
2. Tempo and time signature are first-class: they drive layout, bar lines,
   playback timing, and the metronome.
3. Note durations (whole → 16th, dotted), rendered and audible.
4. Undo/redo, multi-select, copy/paste.
5. Practice pack: metronome, count-in, loop a bar range, 50–100 % speed.
6. Technique notation: hammer-on/pull-off, slides, bends, dead notes, palm
   mute — rendered in the tab and audible in MIDI playback.
7. Alternate tunings (Standard, Drop D, Eb, DADGAD, Open G) + capo.
8. Save/load as an app-only binary `.lick` file; localStorage autosave;
   ASCII-tab export to clipboard.
9. Training-data export (audio + detected-vs-corrected notes) keeps working.

## Non-goals (this iteration)

- Full songs: sections, repeats, multi-line wrapped score view.
- Triplets/tuplets (the tick resolution reserves room; no UI yet).
- Cloud sharing/links, backend storage, real DRM on files.
- Standard notation (staff) rendering.

## Constraints

- **Maintainable + modular**: strict model/view/controller/services split
  (below). No module reads another's internals; pure logic stays DOM-free and
  unit-testable.
- **Premium-ready**: everything ships free today, but capabilities (e.g.
  practice pack, techniques, file export) may become paid. All gateable
  features check a central capability registry — one switch point, no hunting
  through the UI later.
- **Perf**: machine runs hot — no per-frame layout thrash; rendering updates
  are incremental (touch only changed notes), playback scheduling on the
  AudioContext clock, no continuous rAF while idle.

## Architecture

```
src/features.js            app-wide capability registry (premium-ready gate)
src/tab/
  tab-model.js             pure state + ops + undo/redo (no DOM, no audio)
  tab-lane.js              DOM shell: header strip, lines, gutter, scroll (view)
  tab-render.js            note/stem/beam/technique-glyph drawing (view)
  tab-input.js             pointer + keyboard controller → model ops
  tab-midi-player.js       synth voices + metronome + count-in + loop scheduler
  tab-file.js              .lick encode/decode, localStorage autosave, ASCII export
  transcribe.js            notation helpers (existing; tuning becomes per-tab)
  offline-transcribe.js    detection (existing, untouched)
```

Data flow: `tab-input` calls `tab-model` ops → model emits a change event →
`tab-lane`/`tab-render` reconcile the DOM → `main.js` persists via
`tab-file`/take. Playback reads a *derived* seconds view of the model.

## 1 · Data model (`tab-model.js`)

Musical time in integer ticks, **PPQ = 12** (quarter = 12 → 16th = 3;
triplet-ready without floats).

```js
tab = {
  version: 2,
  tempo: 120,                    // quarter-note BPM, 30–300
  timeSig: { num: 4, den: 4 },   // num 1–12, den ∈ {2,4,8,16}
  tuning: 'EADGBE',              // preset id; presets carry midi arrays
  capo: 0,                       // 0–7
  notes: [{
    id, tick, durTicks,          // durTicks ∈ {3,6,9,12,18,24,36,48} (16th…whole, dotted)
    string, fret,                // string 0–5 display order, fret 0–24
    tech: {},                    // { hp:'h'|'p', slide:'/'|'\\', bend:0.5|1, dead:true, pm:true }
    det: null                    // or { midi, string, fret, tSec, durSec } when seeded by transcription
  }]
}
```

- Seconds are always **derived**: `tSec = tick/12 · 60/tempo`. Tempo change
  re-times everything with zero migration.
- Bar length ticks = `num · 48/den`. Bar lines, bar numbers, metronome accents
  all derive from this. Changing TS re-bars the same ticks (notes don't move).
- MIDI pitch derived from tuning + capo + fret (`transcribe.js` helpers,
  tuning passed per-tab). Legacy v1 models (col/tSec) are migrated on load:
  `tick = col·3`, `durTicks` from durSec quantized, det preserved.
- Ops (all pure, all undoable): `addNote`, `deleteNotes`, `moveNote` (string
  and/or tick), `setFret`, `setDuration`, `toggleTech`, `setTempo`,
  `setTimeSig`, `setTuning`, `setCapo`, `pasteAt`.
- **Undo/redo**: whole-model snapshot stack, cap 100. Licks are tiny;
  snapshots are trivially cheap and immune to op-inverse bugs.
- Chords: multiple notes may share a tick (different strings). One note per
  (tick, string) — adding over an occupied cell replaces.
- Tuning change re-validates: notes whose pitch can't sit on the new string
  are *flagged* invalid (rendered warning state), never silently moved.

## 2 · Editor UX (`tab-lane.js` + `tab-render.js` + `tab-input.js`)

Keeps the current lane shell (header strip, 6 lines + gutter, horizontal
scroll, playhead cursor).

**Grid cursor** — one highlighted cell (string × 16th column):

- Click an empty cell → cursor moves there. Type `0-9` → note created; a
  second digit within ~600 ms forms frets 10–24 (Guitar Pro convention).
- Arrows move the cursor; `Del`/`Backspace` deletes at cursor/selection.
- Click a note → selects it (cursor follows). `Shift+arrows` / `Shift+click`
  extends a range selection (whole columns). `Ctrl+C/V` copy/paste at cursor,
  `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo.
- Duration keys `Q W E R T` = whole half quarter 8th 16th, `.` toggles dotted —
  applies to selection or sets the "current duration" used by new notes.
  Dotted is unavailable on 16ths (4.5 ticks is non-integer; the key no-ops).
- Technique keys on selection: `h` `p` (hammer/pull), `/` `\` (slides),
  `b` (bend cycle: ½ → full → off), `x` (dead), `m` (palm mute).
- Keyboard events bind only while the lane has focus; inputs stopPropagation
  (existing pattern) so app-level shortcuts are untouched.

**Mouse**: vertical drag = move note to another string, pitch preserved, fret
recomputed, shake-reject when impossible (today's behavior, kept). Horizontal
drag = move in time (snaps to 16th grid). Double-click a note = inline fret
edit (kept).

**Durations rendered** as stems + beams below the strip (Guitar Pro style):
stem per column, flags/beams by value, dot for dotted. Techniques as standard
tab glyphs: h/p slur arc, `/` `\` between notes, `b`+arrow, `x` instead of a
number, `PM――` span above. Final look will be live-demoed before/after
against the current lane during implementation.

**Header controls**: tempo (click the BPM number → numeric edit), TS picker,
tuning picker + capo, plus existing Play/Export/Clear/✕. New: Save (.lick),
Open, Copy ASCII. Gutter string names follow the selected tuning.

## 3 · Playback (`tab-midi-player.js`)

- Input: derived `{tSec, durSec, midi, tech}` list from the model — tempo/TS
  respected automatically.
- **Speed** 50–100 %: scales derived times (pitch unchanged — synth, not
  audio stretch).
- **Metronome**: TS-aware click track (accent beat 1; den-appropriate beat
  unit), WebAudio blip voices. Toggle lives on the lane header.
- **Count-in**: one bar of metronome before note playback (toggle).
- **Loop**: selected bar range loops seamlessly — lookahead scheduler on the
  AudioContext clock (schedule iteration n+1 before n ends; no rAF-gap
  seams).
- Techniques audible: slide = linear freq ramp to next note, bend = ramp up
  ½/1 tone, h/p = softened attack, dead = short filtered-noise tick, palm
  mute = lower lowpass cutoff + faster decay.
- Existing behavior kept: works without the amp engine (own AudioContext
  fallback), transport playback still drives the cursor via `tSec` mapping.

## 4 · Persistence + files (`tab-file.js`)

- **`.lick` file**: bytes = magic `GWL1` + format-version byte +
  `deflate-raw(JSON.stringify(tab))` via `CompressionStream`. Binary and not
  human-readable; decode requires the app. (Client-side JS means this is
  obfuscation, not cryptography — accepted.) Open via header button and
  drag-drop onto the lane. Unknown magic/version → friendly error toast.
- **localStorage autosave**: working tab saved (debounced) under a stable
  key; restored when the lane reopens. Clip-attached tabs also persist on the
  take as today (`take.tab`).
- **ASCII export**: classic 6-line text tab with bar lines and technique
  glyphs → clipboard.
- **Training export**: unchanged WAV+JSON bundle; `det` provenance rides on
  seeded notes, `edited` derived by comparing current vs det.

## 5 · Transcription integration

`renderNotesToLane` becomes "seed model": detected notes quantized to ticks
(generalized `quantizeToGrid`), `durTicks` from detected duration (min one
16th), `det{}` stamped. After seeding, transcribed notes and hand-added notes
are identical to the editor.

## 6 · Premium-ready capability gate (`src/features.js`)

```js
export const can = (cap) => registry[cap] !== false;   // default: everything on
// caps: 'tab.edit', 'tab.practice', 'tab.techniques', 'tab.file', 'tab.ascii'
```

UI entry points (buttons, key handlers) and file ops consult `can()` before
acting; gated-off state renders the control disabled with a lock affordance.
Today the registry is all-true and static — later it can read a license/plan
without touching feature code.

## 7 · Testing

- **Unit** (existing pure-test pattern): tick↔seconds math, bar math per TS,
  duration quantization, undo/redo, tuning re-validation, v1→v2 migration,
  serialize and `.lick` encode/decode round-trips, ASCII output snapshot.
- **e2e** (`__tabDebug` bridge, existing pattern): add note via cursor+digits,
  two-digit fret, delete, duration keys, TS change re-bars, tempo change
  re-times playback, save/load round-trip, loop + metronome active flags,
  undo restores.
- **Manual**: side-by-side before/after live demo of the changed lane only.

## 8 · Build order (each phase shippable)

1. **Model + core editing** — `tab-model.js`, cursor, add/delete, keyboard
   entry, undo/redo, v1 migration. (The heart; everything else hangs off it.)
2. **Musical time visible** — durations UI + stems/beams, tempo edit, TS
   picker, re-barred lines, seeding via ticks.
3. **Files** — `.lick` save/open + drag-drop, autosave, ASCII export,
   `features.js` gate wiring.
4. **Practice pack** — metronome, count-in, loop range, speed control.
5. **Techniques** — glyph rendering + audible playback + keys.

## 9 · Risks

- **Rebuild regression**: `tab-lane.js` internals are replaced — the e2e
  bridge tests (existing + new) are the safety net; keep the public lane API
  (`noteOn`, `serialize`, `loadNotes`, playhead fns) stable for `main.js`.
- **Keyboard conflicts** with app-level shortcuts — lane-focus scoping is the
  contract; e2e-test it.
- **Loop seam audibility** — lookahead scheduling addresses it; verify by ear
  on the demo.
- **Scope**: five phases is real work; phases 4–5 can slip to follow-up
  stories without hurting 1–3.
