# Refactor Audit & Executed Plan — branch `refactor`

**Date:** 2026-07-03. Audit + refactor performed in-session (the dispatched
auditor agents hit quota; their partial artifacts — the knob harness and the
UI screenshot sweep under `shots/ui-review/` — were adopted and finished).

## 1. Architecture (post-refactor)

Zero-build ES modules, no framework. One HTML file owns all CSS + markup.

| Area | Modules | Notes |
|---|---|---|
| Boot / god file | `main.js` (**1580 → 1395 lines**) | still the biggest file; §4 lists the next extractions |
| Audio engine | `engine.js` (buildChain), `effects/*` (33 effects, uniform `create(ctx,p)→{input,output,apply,destroy?}`), `effects/worklets/*` (pitchshift, looper, NAM, capture, jam send/recv) | contract audited — no deviations found |
| Loudness | `normalize.js` (measurement: guitar reference + BS.1770 LUFS) + **`loudness.js` (NEW: the when/how controller — debounce, tokens, cache, silence-until-measured, retries)** | controller extracted from main.js; unit-testable |
| Tracks/timeline | `track-lane.js` (render + gestures + zoom + tempo grid), `clip-ops.js`, `take-ops.js` (+ recording-latency comp), `player.js` (shares the live ctx), `recorder.js` (worklet tap) | |
| Presets | `presets.js`, `presets/*`, `preset-browser.js`, `chain-state.js` (chain model **+ extractReverb, now single-source**), `chain-store.js` (persistence incl. zoom) | |
| Jam | `jam.js` (transport: codes/SDP/ULTRA PCM/fallback) + **`jam-ui.js` (NEW: settings-panel flow, extracted from main.js)** | |
| UI chrome | `chain-ui/*` (amp, pedalboard, knob, fx-art, fx-viz, rig-bar, auto-fold, power-on), `transport-ui.js`, `browser-notice.js` | |
| Misc | `calibration/*`, `pitch/*`, `profile-card/*`, `audio/input-channel.js`, `bg.js` + `fx/*` (selectable WebGL backgrounds — all reachable), `fx-ui/interactions.js` (empty mount point by request) | |

## 2. Dead code — removed (grep-verified zero users)

- `track-lane.js` `BAR_W` (superseded by tempo-derived `barPx()`)
- `track-lane.js` `ZOOM_STEPS` (+ its self-referential test) — slider is continuous
- `pedalboard.js` `PEDAL_KNOB_SIZE` (call sites use the literal)
- `chain-ui/amp.js` `NEURAL_LABELS` (+ drift-guard test) — the on-amp model
  `<select>` it labeled was removed earlier; models are preset-driven
- `src/fx/liquidChrome.js` — deleted; `bg.js` dropped it from the registry long
  ago (comment even says so), nothing imported it

## 3. Duplication / idiom fixes — done

- `extractReverb` existed twice (main.js + audit harness) → single export from
  `chain-state.js`, both import it
- Loudness scheduling state was 8 module-level mutables in main.js → one
  `createLoudnessController` closure with getter injection (power-cycle-safe)
- Jam UI was a 100-line block in main.js → `initJamUI({getCtx,getSendNode})`

## 4. Remaining extractions (recommended order, not yet done)

1. **Clipboard + keyboard shortcuts** → `clip-clipboard-ui.js` (~120 lines of
   main.js; needs tracks/playhead/zoom getters + renderTrack callback). Low risk.
2. **E2E bridge** → `e2e-bridge.js` (installE2EBridge + its API). Zero user risk.
3. **Track model + transport wiring** → the big one (~500 lines: tracks state,
   undo, record flow, renderTrack handlers). Do it when track features next grow;
   the handlers object in renderTrack() is the seam.
4. **Settings/calibration/tuner wiring** → `settings-ui.js`. Mechanical.
5. `index.html` CSS monolith → consider splitting per-area `<link>`s only if it
   starts fighting you; zero-build keeps it one file today.

## 5. Extendability notes for upcoming features

- New effect = 1 module + registry entry + PEDAL_TYPES label + motif/viz entry
  (4 touchpoints; acceptable, documented here so nobody hunts).
- New settings section = markup in index.html + an `init*` module (follow
  jam-ui.js as the template).
- New per-track action = one `ctxItem` in `trackMenuItems()` (main.js).
- Sample buffers are shared/immutable app-wide (undo, split, clone, duplicate
  all rely on it) — never mutate `take.samples` in place.

## 6. Verification

Every step landed green: vitest 503 (two removed dead-export tests accounted),
probe 31/31, neural e2e PASS, loudness gate 60/60, jam e2e PASS.
