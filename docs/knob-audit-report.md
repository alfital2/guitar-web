# Knob-Truth Audit — do all knobs actually change the sound?

**Date:** 2026-07-03 · **Method:** `node tools/knob-audit.mjs` — every analytic-amp
knob rendered offline (deterministic guitar reference, seeded reverb) at
min/default/max, compared by integrated-LUFS delta AND log-spectral distance
against a measured self-noise floor (identical render pair = 0.0000, fully
deterministic). Tone-stack knobs tested in clean (drive=1) and hot (drive=8)
contexts. Every pedal param swept too.

## Answer to the owner's question

**Almost everything is real. Two amp knobs were not:**

| Knob | Verdict | Why | Fix |
|---|---|---|---|
| `eq.bass` | **WEAK → fixed** (0.2 dB min→max) | 120 Hz lowshelf sat below the cabinet rolloff — the same trap the neural stack's first bass knob hit | shelf moved to **190 Hz** → now ALIVE (broadband 0.7 dB; band-limited effect several dB) |
| `eq.midFreq` | **DEAD at defaults → by design** | it sweeps the center of the Mid peak, and Mid defaults to 5 = 0 dB — moving a zero-height peak does nothing. With Mid ≠ 5 it is clearly ALIVE (4.2 dB) | none needed — semi-parametric EQ behavior. Worth knowing: it only matters once you set Mid |

Everything else on the amp — drive amount/tone/level/master/blend/midBump,
eq mid/treble, cabinet brightness/body/presence/mix, reverb size/mix — is
**ALIVE** with wide margins (see the full table in the harness output).

## Pedal sweep (33 effects, every param)

All ALIVE except three flagged **WEAK**, all metric-limited rather than broken:

- `compressor.attack` (0.23 dB) — a time-constant; steady-state metrics
  under-read it. Code verified correct.
- `limiter.release` (0.44 dB) — same class.
- `boost.tight` (0.35 dB spectral) — a pre-drive high-pass (20→320 Hz); wiring
  verified in-path (`hp` IS the input node). Low-band-only changes read small on
  broadband metrics; audibly it thins the lows as intended.

## Reproduce

`node tools/knob-audit.mjs --amp-only` (amp knobs, ~1 min) or the full sweep
without the flag. Report-only; safe to run any time.
