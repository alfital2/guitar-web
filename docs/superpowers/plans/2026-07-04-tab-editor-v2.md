# Tab Editor v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the tab lane into a best-in-class lick composer — add/delete notes by mouse and keyboard, real tempo + time signature, durations, undo/redo, app-only `.lick` share files, practice playback (metronome, count-in, loop, speed), technique notation, alternate tunings — while keeping the transcription-seeding and training-export paths working.

**Architecture:** Musical time is the source of truth: integer ticks at PPQ 12 (16th = 3 ticks), seconds always derived from tempo, bars derived from time signature. Strict module split — pure model (`tab-model.js`) → renderer (`tab-render.js`) → input controller (`tab-input.js`) → lane shell (`tab-lane.js`), plus services (`tab-file.js`, extended `tab-midi-player.js`) and an app-wide capability registry (`features.js`) so features can be premium-gated later at one switch point.

**Tech Stack:** Vanilla ES modules, no new dependencies. vitest + jsdom for unit tests, `__tabDebug` bridge for e2e. WebAudio lookahead scheduling (pattern from `src/metronome.js`). `CompressionStream('deflate-raw')` for `.lick` files.

**Spec:** `docs/2026-07-04-tab-editor-v2-design.md` · **Contract used by authors:** all module signatures in the spec §Architecture + the task Interfaces blocks below. **Board story:** maestro `0c3b8cf0`.

## Global Constraints

- Vanilla ES modules only; no new npm dependencies; no TypeScript; no framework.
- Tests: vitest, jsdom env. One file: `npx vitest run tests/<file>.test.js`. Full suite: `npm test` — must stay green after every task (544 baseline tests).
- Pure logic modules (`tab-model.js`, pure exports of `tab-file.js`, `tab-midi-player.js` helpers) never touch DOM or AudioContext directly.
- Perf: no continuous rAF while idle; incremental DOM updates keyed by note id; audio scheduled on the AudioContext clock via chunked lookahead (~50 ms timer, 200 ms horizon); moving visuals use transform/opacity only.
- Premium-ready: every user-facing entry point of a gateable feature checks `can(cap)` from `src/features.js`; caps: `tab.edit`, `tab.practice`, `tab.techniques`, `tab.file`, `tab.ascii`. Default all-true.
- Back-compat: `mountTabLane` keeps its existing API surface (`noteOn`, `getNotes` returning v1-shaped dumps, `serialize` returning v2 state, `loadNotes` accepting v1 or v2, `setBpm`, playhead fns, header callbacks). Existing `tests/tab-lane.test.js` stays green. Old `take.tab` v1 models migrate on load.
- Ticks: `PPQ = 12`, `SIXTEENTH = 3`, `DURATIONS = [48, 36, 24, 18, 12, 9, 6, 3]` (no dotted 16th). `MAX_FRET = 24`. Tuning change keeps frets (pitch re-derives) — conscious spec amendment.
- jsdom lacks `setPointerCapture`/`releasePointerCapture` — call inside try/catch.
- Commits: conventional (`feat(tab): …`), one per task, staged file lists explicit.
- Every code step contains complete code — no placeholders anywhere in this plan.

---
