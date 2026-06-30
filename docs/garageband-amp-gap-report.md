# GarageBand Amp Gap Report

Compared our `src/presets/garageband.js` recipes against the **actual GarageBand
10.4.14 factory patches**, read directly from the app bundle:
`/Applications/GarageBand.app/Contents/Resources/Patches/Audio/Electric Guitar and Bass/{01 Clean Guitar,02 Crunch Guitar}/<Name>.patch/#Root.cst`

No GUI automation needed — every patch is a file. Extracted per patch: the
**amp family** (GarageBand Smart Control template) and the **effect modules**
exposed (Smart Control labels). Scripts: `scratchpad/extract_gb.mjs`,
`compare.mjs`.

## What's reliable vs not

| Signal | Reliability | Notes |
|---|---|---|
| Amp family (Tweed / Vox / Marshall / Blackface / Indie) | **High** | Each patch carries one `Electric Guitar <X>` Smart Control template. |
| Effect modules exposed | Medium | Labels show *available* knobs; base delay+reverb+tremolo appear on almost every patch as template defaults — not proof they're active. |
| Exact knob values (gain/bass/mid/treble/presence/master, FX amounts) | **Not recoverable** here | Binary-encoded AU floats in `#Root.cst`. Needs the reverse-engineering pass (declined). GarageBand's Amp Designer UI shows no numbers either. |

GarageBand's 5 amp families ↔ real Amp Designer model ↔ our voicing helper:

| GB family | Real amp | Our matching voicing |
|---|---|---|
| Small Tweed | `Small Tweed Combo` (Fender tweed) | `TWEED` |
| British Combo | `British Combo` (Vox AC30 chime) | `BRITCHIME` |
| Vintage British | `Vintage British Stack` (Marshall plexi) | `BRITCRUNCH` / `MODERN` |
| Face Amp | Fender Blackface (surf/jazz/country usage) | `BLACKFACE` |
| Indie Amp | jangly mid combo (ambiguous) | any of the above — judge per patch |

## Score

**41 patches** (20 clean + 21 crunch): **20 OK · 6 Indie (acceptable) · 14 amp-family MISMATCH · 1 MISSING preset.**

## Structural gaps (actionable)

### A. Wrong amp family — 14 presets

| Patch | GarageBand amp | We voiced | Fix to |
|---|---|---|---|
| Clean / Clean Echoes | Fender Tweed | BLACKFACE | TWEED |
| Clean / Country Gent | Fender Tweed | BLACKFACE | TWEED |
| Clean / Echo Studio | Fender Tweed | BLACKFACE | TWEED |
| Clean / Mystery Chorus | Fender Tweed | BLACKFACE | TWEED |
| Clean / Move the Mics | Marshall plexi | BLACKFACE | BRITCRUNCH |
| Clean / Old Time Tremolo | Fender Blackface | TWEED | BLACKFACE |
| Clean / Worlds Smallest Amp | Vox AC30 | TWEED | BRITCHIME |
| Crunch / Broken Up Brit | Vox AC30 | BRITCRUNCH | BRITCHIME (crunchy) |
| Crunch / Double Driven | Vox AC30 | MODERN | BRITCHIME (driven) |
| Crunch / Eighties Goth | Vox AC30 | BRITCRUNCH | BRITCHIME (crunchy) |
| Crunch / Fat Amp | Fender Blackface | BRITCRUNCH | BLACKFACE (pushed) |
| Crunch / Honk n' Drive | Fender Tweed | BRITCHIME | TWEED |
| Crunch / Razor Amp | Fender Blackface | MODERN | BLACKFACE + heavy pedals |
| Crunch / Royal Rock | Vox AC30 | BRITCRUNCH | BRITCHIME (crunchy) |

### B. Missing preset — 1
- **Heavenly Tweed** (01 Clean Guitar, Small Tweed family) — GarageBand has 20 clean patches, we ship 19. Not in `garageband.js`.

### C. JSON presets needing a family check — 6
External JSON files (not voicing-helper based); verify their amp voicing matches the GB family:

| Patch | GB family / amp |
|---|---|
| Clean / Multi-Phase Amp | Face Amp → Blackface |
| Clean / Spin Speaker Blues | Face Amp → Blackface |
| Clean / Surfin' in Stereo | Face Amp → Blackface |
| Clean / Vibrato Verb | Small Tweed → Tweed |
| Crunch / Panning Swirl | Vintage British → Marshall |
| Crunch / Woolly Octave | Indie Amp → jangly mid |

## Param-level gaps (our amp schema vs GB Amp Designer)

- **GB has, we don't:** Presence, Master (separate from gain), named Cabinet model, Mic type + position. We abstract cab → `brightness`/`body`/`mix`.
- **We have, GB doesn't:** `blend` (clean/dirty), `midBump`, sweepable `midFreq`. GB tone stack is fixed-frequency.
- **Loose maps:** GB Gain → `drive.amount`; GB Master → `drive.level` (curves differ). GB Channel EQ = 8-band parametric vs our bass/mid(+freq)/treble — lossy.
- **Same numbers ≠ same sound:** different DSP. A true match is by ear only.

## Update — resolved (2026-06-30)

- **Values recovered from the files** (no GUI/screenshots): decoded the embedded
  `NSKeyedArchiver` Smart-Control archives in each `#Root.cst` → per-patch macro
  values (Gain/Tone/Drive + reverb/echo/tremolo/chorus amounts + on/off).
  Decoder: `scratchpad/decode_macros.py` → `gb_macros.json`.
- **New amp params shipped:** `Master` (drive power-amp output) + `Presence`
  (cabinet HF high-shelf), both neutral at their default so existing presets are
  unchanged. `src/effects/drive.js`, `src/effects/cabinet.js` + tests.
- **14 amp-family mismatches re-voiced** + **Heavenly Tweed added**, tuned from
  the decoded macros. `src/presets/garageband.js`.
- Verified: 223 unit tests pass; audio-QA 55/55 (no clipping/runaway).
- **Still open:** the 6 JSON presets (Multi-Phase, Spin Speaker, Surfin',
  Vibrato Verb, Panning Swirl, Woolly Octave) — family noted, voicing inside the
  JSON not yet reconciled.

## Effect signatures (indicative)

The Smart Control "signature" effect beyond the base template lines up with the
patch names where it matters and is already covered in our recipes: Double Brit
Phaser → phaser ✓, Woolly Octave → octave ✓, Honk n' Drive → wah ✓, Vibrato
Verb → vibrato ✓, Mystery Chorus → (GB exposes Ringshifter+fuzz; we use chorus).
Exact effect *amounts* are not recoverable without the binary float decode.
