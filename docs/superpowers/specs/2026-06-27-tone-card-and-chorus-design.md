# Guitar Tone Card + Chorus Block — Design

**Date:** 2026-06-27
**Status:** Approved, ready for implementation plan
**Builds on:** the effects engine + calibration (fingerprints) + schema-driven UI.

Two independent features bundled into one plan:
1. **Tone Card** — a FIFA-style attribute card visualizing a guitar profile's
   fingerprint as a 6-axis radar.
2. **Chorus** — a new effect block (modulation), following the existing
   effect-module pattern.

---

## Feature 1: Guitar Tone Card

### Vision
For each saved guitar profile, show a FIFA-player-card-style visual: a 6-axis
**radar/hexagon** of tonal attributes derived from the stored calibration
fingerprint, with an **archetype label** headline. Static per guitar; regenerated on
recalibration. No new audio capture — reuses the fingerprint we already store.

### Attributes (locked)
Six frequency-character stats, each **0–100** (50 = neutral/flat):
**Body, Warmth, Mids, Presence, Brightness, Air.**

Band groups (over the 10 fingerprint bands `[80,133,223,371,619,1033,1724,2874,4794,8000]`):
- Body: 80–180 Hz (bands 0–1)
- Warmth: 180–470 Hz (bands 2–3)
- Mids: 470–1300 Hz (bands 4–5)
- Presence: 1300–2300 Hz (band 6)
- Brightness: 2300–5500 Hz (bands 7–8)
- Air: 5500–8000 Hz (band 9)

### Scoring
Each stat = average of its bands' normalized dB → `score = clamp(round(50 + dB*5), 0, 100)`
(so +10 dB → 100, −10 dB → 0, 0 dB → 50).

### Archetype (headline)
Rules over the stats (first match wins):
- All stats within ±12 of 50 → **"Balanced"**.
- Mids ≥ 65 and higher than Body & Brightness → **"Mid-Forward"**.
- Mids ≤ 35 and both ends (Body/Warmth and Brightness/Air) higher → **"Scooped"**.
- (Brightness+Air)/2 − (Body+Warmth)/2 ≥ 12 → **"Bright & Glassy"**.
- (Body+Warmth)/2 − (Brightness+Air)/2 ≥ 12 → **"Warm & Dark"**.
- else → **"Balanced"**.

### Architecture
- `src/profile-card/attributes.js` (pure): `fingerprintToStats(fingerprint) → {body,warmth,mids,presence,brightness,air}`; `archetype(stats) → string`.
- `src/profile-card/radar.js` (pure): `radarPoints(stats, cx, cy, radius) → [{x,y}×6]` — hexagon vertex geometry; stat 100 = outer ring, 0 = center. Order: body, warmth, mids, presence, brightness, air, starting at top (−90°), clockwise.
- `src/profile-card/ui.js`: `renderProfileCard(container, {name, stats, archetype}) → void` — builds an `<svg>` hexagon (grid + filled stat polygon) + the 6 stat labels with values + the archetype headline + name. Clears container first.
- Integration (`main.js`, `index.html`): a "Tone Card" panel. On profile select / calibrate / start, if there's an active profile, compute stats from its fingerprint and render the card; otherwise show a placeholder message.

### Testing
- `attributes`: flat fingerprint (all 0) → all stats 50, archetype "Balanced"; treble-heavy fingerprint → high Brightness/Air, archetype "Bright & Glassy"; bass-heavy → "Warm & Dark".
- `radar`: returns 6 points; a stat of 100 lands at `radius` from center, 0 at the center; top point is at angle −90°.
- `ui` (jsdom): renders an `<svg>`, the name, the archetype text, and 6 stat labels.

### Out of scope
- Live/animated card; comparing two guitars side by side; numeric "overall" rating.

---

## Feature 2: Chorus Effect Block

### Vision
Add modulation (chorus) to the effects library so ambient/clean tones (notably Tim
Henson) get their characteristic shimmer. Follows the exact effect-module interface.

### Module — `src/effects/chorus.js`
- Exports `schema` (`type:'chorus'`, label `'Chorus'`) and `create(ctx, params) → {input, output, apply}`.
- Mono chorus graph: `input → dry → output`; `input → delay → wet → output`; an
  `OscillatorNode` (sine) → `lfoGain` modulates `delay.delayTime` around a ~25 ms base.
- `create` calls `osc.start()`.
- **Params:**
  - `rate` (0–10 Hz, default 1.5) → `osc.frequency`.
  - `depth` (0–10, default 4) → modulation amount in ms (map 0–10 → 0–0.008 s) into `lfoGain.gain`.
  - `mix` (0–1, default 0.4) → `wet.gain`. (`dry.gain` = 1.)
- Base delay constant ~0.025 s on the delay node.

### Registry + UI
- Register `chorus` in `src/effects/index.js`. The schema-driven UI renders its knobs
  automatically — no UI changes.

### Test-infra addition
- `tests/fake-audio-context.js` gains a `createOscillator()` stub: a node with
  `frequency` (param), `type`, `connect()`, and a no-op `start()`/`stop()`.

### Preset update
- Add a `chorus` entry to `src/presets/henson-clean.json` (after `compressor`,
  before/after `eq`) — e.g. `{ "type":"chorus","params":{ "rate":1.2, "depth":5, "mix":0.35 } }`
  — so Henson finally shimmers. (Existing "all presets valid" test will validate it.)

### Testing
- `chorus` (fake context): builds a delay + oscillator + dry/wet gains; `apply` sets
  `osc.frequency`, `lfoGain.gain` (from depth), and `wet.gain` (from mix); oscillator
  `start()` was called; `input`/`output` are gain nodes.
- registry test (existing) updated to expect `chorus` among the types.

### Out of scope
- Stereo chorus / multi-voice; flanger/phaser (future modulation variants).

---

## Success criteria
- Calibrate or select a guitar → a tone card with a 6-axis radar + archetype appears,
  matching the guitar's character.
- Chorus appears as a selectable/auto-rendered effect; adding it audibly thickens the
  clean tone; the Henson preset now shimmers.
- Full test suite green.
