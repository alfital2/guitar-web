# Draggable, Editable Effects Chain — Design

Date: 2026-06-28

## Goal

Turn the fixed effects chain into a directly editable signal chain. The user can
reorder effects, remove them (drag off the board), and add new ones from a
palette. The amp head (drive → eq → cabinet) keeps its faceplate at the top of
the UI and stays locked, acting as a fixed anchor in the signal path that pedals
can sit before or after.

Audio/DSP processing code (`engine.js`, `effects/*`, `dsp.js`, calibration,
pitch) is unchanged. This is a UI + state-management + graph-rebuild feature.

## Decisions (locked during brainstorming)

1. **Amp head stays special.** drive/eq/cabinet are locked, fixed internal order,
   rendered in the top amp faceplate as today. Only pedals are draggable /
   removable / addable.
2. **Amp is a fixed anchor in the one signal row.** Pedals form a single
   reorderable row; a slim non-draggable `▣ AMP` chip marks the amp's signal
   position. Pedals left of it = pre-amp, right = post-amp. The full amp
   faceplate remains at the top of the UI; the chip is only the signal marker.
3. **Always editable.** The chain is a data model rendered on page load and
   editable even before Start. If audio is running, the graph rebuilds live; if
   stopped, the model updates and the graph is built correctly on Start.
4. **Drag by the nameplate.** Knobs keep their own pointer-drag (value). Whole
   pedal is grabbed by its nameplate / top bar. Pointer-based reordering, not
   HTML5 drag-and-drop.
5. **Drag off the board to delete.** No ✕ button. Dropping a pedal outside the
   pedalboard bounds removes it, with a "release to remove" visual cue.
6. **Add → append.** A `＋` tile at the row end opens a palette of effect types;
   the chosen effect is appended at the end (post-amp), then the user drags it
   into place.
7. **Duplicates allowed.** Multiple instances of the same type are permitted.
   Units are keyed by a unique `instanceId`, not by type.
8. **Preset switch replaces the chain.** Picking a preset discards current edits
   and loads that preset's chain.
9. **Persist to localStorage now, DB later.** Edits are saved on every mutation
   behind a small storage interface so a DB backend can replace localStorage
   without touching callers.
10. **Loudness re-normalizes automatically** whenever the chain structure
    changes (debounced). Not a user-facing choice.

## Data Model

`chainState` is the single source of truth: an ordered array of units.

```
unit = { instanceId: number, type: string, params: { [key]: number }, locked: boolean }
```

- Array order == signal order.
- `locked: true` for the three amp modules (drive, eq, cabinet). They are never
  reordered relative to each other, never removed, never have pedals inserted
  between them.
- The amp block is the maximal contiguous run of locked units. Invariant: after
  any mutation the amp block remains contiguous and in drive→eq→cabinet order.
- `params` holds live values; knob edits write through here so values survive
  graph rebuilds and persistence.

### `src/chain-state.js` (pure, no DOM/audio)

Exposes pure functions operating on a chain array (returning a new array):

- `fromPreset(presetChain, nextId)` → builds units with fresh `instanceId`s and
  `locked` flags (locked iff type ∈ {drive, eq, cabinet}); returns `{ chain, nextId }`.
- `ampBounds(chain)` → `{ start, end }` index range of the contiguous amp block
  (or null if no amp modules).
- `move(chain, instanceId, targetIndex)` → moves a pedal to a new slot, clamped
  so it lands before the amp block or after it, never inside; amp block stays put.
- `add(chain, type, schema, nextId)` → appends a new unit with schema-default
  params and a fresh id; returns `{ chain, nextId }`.
- `remove(chain, instanceId)` → drops a pedal (no-op if locked).
- `setParam(chain, instanceId, key, value)` → returns chain with that unit's
  param updated.
- `toEngineChain(chain)` → `[{ type, params }]` in order, the shape `buildChain`
  expects.
- `signature(chain)` → stable string of types in order (for the loudness cache).

`nextId` is owned by `main.js` (a module-level counter); chain-state functions
take it as input and return the next value where they mint ids, keeping
chain-state pure and deterministic for tests.

## Audio Rebuild

`main.js` refactor:

- `rebuildGraph()` (replaces the body of today's `loadPreset` wiring):
  1. If an engine exists, disconnect `calibrationEq.output` and `engine.output`.
  2. `engine = buildChain(ctx, chainState.toEngineChain(currentChain), registry)`.
  3. Re-render amp head (locked modules) and pedalboard (everything) from
     `currentChain`.
  4. Wire `calibrationEq.output → engine.input` and `engine.output → normGain`.
  5. Trigger debounced loudness re-normalization.
- When `ctx` is null (audio stopped): skip steps 1, 2, 4; only re-render the
  pedalboard from the model and persist. `start()` builds the graph from
  `currentChain` exactly as `rebuildGraph` step 2/4.
- Knob `onParamChange` → `chainState.setParam` (updates model + persists) **and**
  `engine.setParam` when the engine exists. Reorder/add/remove → mutate model,
  persist, `rebuildGraph()`.
- Amp-head knobs and pedal knobs both route through the same model update so
  params persist.

The amp-head render still receives only the locked modules; the index mapping
(`ampIdx` / `pedIdx` in today's code) is replaced by `instanceId`-based lookups
into `currentChain`.

## UI — Pedalboard

`renderPedalboard(container, units, handlers)` renders from the ordered units:

- Pedals before the amp block, then the `▣ AMP` anchor chip, then pedals after.
- The anchor chip is a slim, non-draggable card styled to read as the amp's
  position (compact, amber-tinted, label "AMP").
- A `＋` tile at the end of the row. Clicking it opens a palette popover listing
  the **pedal** effect types only — compressor, delay, reverb, chorus (and any
  future pedal effects). Drive/EQ/Cabinet are amp-head modules and are excluded.
  Selecting appends via `handlers.onAdd(type)`.
- Each pedal keeps its existing look (color stripe by type, screws, nameplate,
  knobs, foot LED). The nameplate becomes the drag handle (cursor: grab).

Palette contents: **non-amp effect types only** (delay, reverb, chorus,
compressor, plus future additions). Drive/EQ/Cabinet belong to the amp head and
are not addable as pedals. This is config-driven (a `PEDAL_TYPES` allowlist or
`schema.zone` tag) so future effects slot in by adding their module to the
registry.

## Drag Mechanics

Pointer-based, in the pedalboard render layer:

- `pointerdown` on a nameplate starts a drag: clone/lift the pedal visually
  (follows cursor via transform), mark the source slot.
- `pointermove`: compute the target slot from cursor x against sibling pedal
  centers; shift siblings to reveal the gap. Clamp target so it can't land inside
  the amp block.
- If the cursor leaves the pedalboard bounds: switch to "remove" affordance
  (board dims / red outline, lifted pedal shows it'll be deleted).
- `pointerup`:
  - inside bounds → `handlers.onMove(instanceId, targetIndex)`.
  - outside bounds → `handlers.onRemove(instanceId)`.
- `pointercancel` / Escape → abort, snap back.
- Knobs stop propagation on their own `pointerdown` so grabbing a knob never
  starts a pedal drag.

Accessibility: each pedal also gets keyboard reorder (Left/Right to move,
Delete to remove) on the nameplate handle (role/aria), so drag isn't the only
path. Minimal but present.

## Persistence

`src/chain-store.js`:

- `load()` → saved chain (array of `{ type, params }` + nextId snapshot) or null.
- `save(chain)` → persists current chain.
- Backed by `localStorage` key `gs-chain`. Single interface; a DB-backed
  implementation can replace the internals later with no caller changes.
- Persisted shape stores `type` + `params` (+ a saved `nextId` so ids stay
  unique across reloads); `locked` is re-derived on load, instanceIds re-minted.

Load order on page init: if `chain-store.load()` returns a chain, use it; else
load the default preset. Every mutation (add/remove/move/setParam, preset switch)
calls `save`.

## Loudness Normalization

- Replace the preset-name cache key with `chainState.signature(currentChain)`
  (types in order). Reorder/add/remove changes the signature → re-measure;
  param-only changes keep the signature → no re-measure (param tweaks barely move
  loudness and re-measuring on every knob drag is wasteful).
- `rebuildGraph` calls a debounced `normalizeLoudness(currentChain)` that uses
  `measureLoudnessGain(toEngineChain(currentChain), …)` and sets `normGain.gain`.

## Testing

- `tests/chain-state.test.js`: `fromPreset` flags locked correctly; `move` keeps
  the amp block contiguous and rejects intra-amp drops; `move` across the amp
  (pre↔post) works; `add` appends with defaults + fresh id; duplicates get
  distinct ids; `remove` ignores locked units; `toEngineChain` preserves order;
  `signature` stable and order-sensitive.
- `tests/chain-store.test.js`: save→load round-trip; empty store → null;
  malformed JSON → null (no throw).
- `tests/pedalboard.test.js` (extend): renders the `▣ AMP` anchor; renders a `＋`
  add tile; `onAdd`/`onRemove`/`onMove` fire with correct args; n pedals → n
  cards; existing assertions stay green.
- All existing tests remain green.

## Files

- New: `src/chain-state.js`, `src/chain-store.js`,
  `tests/chain-state.test.js`, `tests/chain-store.test.js`.
- Edit: `src/chain-ui/pedalboard.js` (anchor, add tile, drag handles, delete
  cue), `src/main.js` (state model, `rebuildGraph`, persistence, loudness key),
  `index.html` (anchor / add-tile / palette / delete-cue styles),
  `tests/pedalboard.test.js`.
- Unchanged: `engine.js`, `effects/*`, `dsp.js`, `normalize.js` (called with a
  live chain), calibration, pitch, amp.js (still renders locked modules).

## Out of Scope (YAGNI)

- Saving/naming multiple custom rigs (one persisted chain for now).
- Reordering amp modules or moving the amp itself.
- DB backend (interface only; localStorage now).
- Adding the new effect types themselves — that's a follow-up; this delivers the
  add/remove/reorder framework and palette wiring so new effects are drop-in.
