# GarageBand Patch Recipes — reproducing them with this app's effects

How to dial in the 40 GarageBand guitar patches (Clean + Crunch/Distorted
browsers) using **our** effect registry and the amp-head **cabinet tuning**.

> Note on accuracy: Apple doesn't publish per-patch signal chains. The amp model
> and effect choices below are inferred from each patch name, its browser
> category, and standard Amp Designer / Pedalboard conventions. The sonic
> character is what matters — these recipes get you the same *result* with our
> nodes, not a byte-identical clone.

## Our building blocks

Amp head (locked, always in this order): **drive → eq → cabinet**.

- **drive** — `amount` (gain), `tone` (LP), `level`, `blend` (clean blend), `midBump`
- **eq** — `bass`/`mid`/`treble` (0–10, 5 = flat), `midFreq` (200–2000 Hz)
- **cabinet** — `brightness` (LP 3.5–6.5 kHz), `body` (2.5 kHz presence 0–6 dB), `mix`

Pedals (addable): compressor, boost, gate, fuzz, octave (octave-up), wah, autowah,
chorus, flanger, phaser, tremolo, vibrato, **autopan**, **rotary**, ringmod,
delay, tape-echo, pingpong, reverb, widener, limiter, pitchshift, looper.

### Cabinet/amp voicing cheat-sheet

The "tuning" that makes an amp read as tweed vs blackface vs British is mostly
cabinet `brightness`/`body` + the EQ tilt. Start from one of these:

| Voicing | drive.amount | eq (bass/mid/treble, midFreq) | cabinet (bright/body) | character |
|---|---|---|---|---|
| **Tweed** (Fender Deluxe/Bassman) | 1–3, blend ~0.4 | 6 / 6 / 4 @ 700 | 3 / 7 | warm, woody, breaks up early |
| **Blackface** (Twin/Deluxe Reverb) | 0–1 | 5 / 4 / 7 @ 600 | 7 / 4 | bright, scooped, glassy clean |
| **British chime** (Vox AC30) | 1–3 | 5 / 6 / 6 @ 1800 | 6 / 6 | jangly, mid-forward, chimey |
| **British crunch** (Marshall) | 4–6, midBump 3 | 5 / 6 / 5 @ 750 | 5 / 6 | punchy mid crunch |
| **Modern high-gain** | 7–9 | 6 / 4 / 6 @ 800 | 5 / 5 | tight, saturated, scooped |

---

## 01 Clean Guitar

**Amazing Tweed** — warm tweed combo on the edge of breakup; blooms when you dig in.
→ Tweed voicing (drive.amount 2.5, blend 0.45, tone 5). cabinet 3/7. reverb size 0.4 mix 0.12.

**Brit and Clean** — chimey, jangly Vox-style clean.
→ British-chime voicing (drive.amount 1.5, midBump 1). eq mid 6 @ 1800, treble 6. cabinet 6/6. reverb 0.4/0.12.

**Chicken Pickin'** — snappy, squashed, bright country twang.
→ compressor (threshold −22, ratio 4, makeup 4) → Blackface voicing (cabinet 7/4) → tape-echo time 110 feedback 0.15 mix 0.12 (slapback) → reverb 0.3/0.1.

**Clean Echoes** — spacious clean drenched in rhythmic stereo echoes.
→ Blackface clean → pingpong time 380 feedback 0.4 mix 0.3 → reverb 0.6/0.2.

**Clean Studio Stack** — big, full-bodied clean from a stack run clean.
→ British-crunch voicing but drive.amount 0.5 (clean). eq bass 6, body up: cabinet 5/7. light reverb 0.4/0.1. Optional widener width 4.

**Cool Jazz Combo** — mellow, rolled-off, warm neck-pickup jazz tone.
→ Blackface body but dark: drive 0, eq bass 6 / mid 5 / treble 3, cabinet brightness 2 / body 7 (tone knob rolled off). reverb 0.4/0.1.

**Country Gent** — bright twangy rockabilly with slapback.
→ compressor (ratio 3) → Blackface bright (cabinet 7/4, treble 7) → tape-echo time 130 feedback 0.2 mix 0.15 (slapback) → reverb 0.35/0.12.

**Dublin Delay** — The Edge: rhythmic dotted-eighth ambience.
→ British-chime clean → delay time 375 feedback 0.35 mix 0.4 (set to dotted-⅛ of the song tempo) → reverb 0.6/0.18. Add widener 5 for stereo.

**Dyna-Trem** — pulsing, dynamic amp tremolo on a clean.
→ Blackface clean → **tremolo** rate 5 depth 0.6 shape sine → reverb 0.4/0.12.

**Echo Studio** — studio clean with prominent slap/echo repeats.
→ Clean combo → tape-echo time 300 feedback 0.45 tone 4 flutter 3 mix 0.3 → reverb 0.5/0.15.

**Move the Mics** — natural room tone showcasing mic placement (minimal FX).
→ Tweed/blackface clean, no modulation. cabinet mix 1, brightness 5/body 5. reverb 0.5/0.16 as "room". (Our cabinet `mix` blends mic'd vs direct.)

**Multi-Phase Amp** — swirling phaser-modulated clean.
→ Clean combo → **phaser** rate 0.5 depth 7 feedback 0.5 mix 0.5 → reverb 0.4/0.12.

**Mystery Chorus** — wide, shimmering chorused clean.
→ Blackface clean → **chorus** rate 0.8 depth 5 mix 0.45 → widener 5 → reverb 0.4/0.12.

**Old Time Tremolo** — choppy, old-school opto tremolo.
→ Tweed voicing → **tremolo** rate 6 depth 0.85 shape square (choppier) → reverb 0.4/0.12.

**Spin Speaker Blues** — swirling Leslie-rotary bluesy tone.
→ Tweed/blackface with a touch of grit (drive.amount 2) → **rotary** speed 6 depth 6 mix 0.6 → reverb 0.4/0.12. (See preset *Spin Speaker Blues*.)

**Surfin' in Stereo** — drippy surf reverb panning across the field.
→ Blackface bright → **tremolo** rate 4.5 depth 0.7 → **autopan** rate 2 depth 0.8 → reverb size 0.7 mix 0.32 (big spring). (See preset *Surfin' in Stereo*.)

**Vibrato Verb** — watery, wobbling pitch vibrato clean.
→ Blackface clean → **vibrato** rate 5 depth 4 → reverb 0.6/0.22. (See preset *Vibrato Verb*.)

**Warm British Combo** — rounded, warm British clean.
→ British-chime but darker: cabinet brightness 4 / body 6, treble 5. drive.amount 1. reverb 0.4/0.1.

**Worlds Smallest Amp** — boxy, lo-fi, low-wattage breakup (tiny Champ).
→ Tweed but tiny: drive.amount 3.5 blend 0.6, eq bass 3 (thin) / mid 6 / treble 5, cabinet brightness 3 / body 4 / mix 1, tone 4. No reverb (or tiny 0.25/0.08).

---

## 02 / 03 Crunch & Distorted Guitar

**Amp Switcher** — demos blending/switching a clean and a crunch amp.
→ Two voicings A/B: run drive.blend ~0.5 so clean + driven coexist (drive.amount 4). cabinet 5/6. light delay 300/0.2/0.12.

**Big Brute Blues** — thick, cranked, bluesy crunch.
→ Tweed cranked: drive.amount 5 tone 5 midBump 3, eq bass 6 / mid 6 / treble 4, cabinet 4/7. reverb 0.4/0.12.

**British Invasion** — 60s jangle-crunch AC30 grind.
→ British-chime cranked: drive.amount 4 midBump 2, eq mid 6 @ 1800 treble 6, cabinet 6/6. light reverb 0.35/0.1.

**Broken Up Brit** — Marshall-style edge-of-breakup crunch.
→ British-crunch: drive.amount 4.5 midBump 3, cabinet 5/6. reverb 0.35/0.1.

**Cheap Studio Time** — gritty, cheap, lo-fi amp grind.
→ Small-combo crunch: drive.amount 5 tone 4 (dark), eq treble 4, cabinet brightness 3 / body 4, mix 1. light tremolo rate 4 depth 0.4 + spring reverb 0.4/0.14.

**Chord Burner** — aggressive chord-driving distortion.
→ Modern high-gain: gate (threshold 2.5) → drive.amount 7 midBump 2 → eq 6/4/6, cabinet 5/5 → short delay 250/0.18/0.12.

**Double Brit Phaser** — phase-swirled double-Marshall crunch.
→ British-crunch (drive.amount 5) → **phaser** rate 0.4 depth 6 feedback 0.5 mix 0.5 → light delay 300/0.2/0.12. (See preset *Double Brit Phaser*.)

**Double Driven** — stacked overdrive into amp gain; saturated lead.
→ **boost** gain 8 tight 4 → drive.amount 7 midBump 3 → eq 5/6/5, cabinet 5/6. reverb 0.3/0.1.

**Eighties Goth** — dark, atmospheric, chorused 80s wash.
→ British/modern dark (drive.amount 6, treble 5, cabinet brightness 4) → **chorus** rate 0.6 depth 6 mix 0.4 → delay time 450 feedback 0.4 mix 0.3 → reverb 0.7/0.28.

**Fat Amp** — thick, low-heavy fat crunch.
→ British-crunch, bass-forward: drive.amount 5, eq bass 7 / mid 6 / treble 4, cabinet brightness 4 / body 7. light reverb 0.3/0.1.

**Heartbroken** — emotive, sustaining lead crunch.
→ British-crunch (drive.amount 5 midBump 4 for sustain) → compressor (ratio 3, makeup 3) → delay 400/0.35/0.2 → reverb 0.6/0.2.

**Honk n' Drive** — nasal, midrange-honky overdrive.
→ Vox crunch (drive.amount 4) with **wah** parked: wah position 6 resonance 8 mix 0.6 (cocked-wah honk), or eq mid 8 @ 1200. cabinet 6/6. light reverb 0.3/0.1.

**Indie Scorcher** — scrappy, bright, lo-fi indie distortion.
→ British combo cranked + a little fuzz: fuzz fuzz 4 tone 6 level 4 → drive.amount 3, eq treble 6, cabinet 5/5. reverb 0.3/0.1.

**Old School Punk** — raw, fast, buzzsaw punk distortion.
→ British stack cranked, bright: drive.amount 6 tone 7 midBump 1, eq 5/5/7, cabinet brightness 6 / body 5. No modulation, tiny reverb 0.25/0.08.

**Panning Swirl** — swirling, auto-panned modulated crunch.
→ British-crunch (drive.amount 5) → **phaser** rate 0.4 depth 6 mix 0.4 → **autopan** rate 1.5 depth 0.9 → light delay 300/0.2/0.12. (See preset *Panning Swirl*.)

**Practice Space** — roomy garage practice-amp crunch.
→ Mid crunch (drive.amount 4), cabinet 5/5 → reverb size 0.5 mix 0.22 (room). No other FX.

**Razor Amp** — sharp, slicing, tight high-gain.
→ gate (threshold 3) → drive.amount 8 tone 7 (bright) midBump 1 → eq 6/4/7, cabinet brightness 6 / body 5. tight: boost.tight 5 in front. tiny reverb 0.25/0.08.

**Royal Rock** — classic British arena-rock crunch.
→ British-crunch (drive.amount 5 midBump 3) → light delay 350/0.25/0.12 → reverb 0.4/0.14.

**Starlit Cavern** — spacious, cavernous, ambient distortion.
→ Modern gain (drive.amount 6) → chorus rate 0.5 depth 4 mix 0.3 → delay time 500 feedback 0.45 mix 0.32 → reverb size 0.9 mix 0.35. widener 6.

**Swampland** — swampy southern tremolo-crunch.
→ Tweed cranked (drive.amount 5 tone 4, cabinet 4/7) → **tremolo** rate 4 depth 0.6 → spring reverb 0.45/0.16.

**Woolly Octave** — thick, woolly octave-fuzz lead.
→ **octave** (Octave-Fuzz) octave 0.7 fuzz 6 tone 5 level 4 → drive.amount 3 → eq bass 6 / mid 6 / treble 4, cabinet brightness 4 / body 7. reverb 0.3/0.1. (See preset *Woolly Octave*.) For a sub-octave instead, swap in **pitchshift** semitones −12 mix 0.5.

---

## Effect → patch index

- **rotary**: Spin Speaker Blues
- **autopan**: Surfin' in Stereo, Panning Swirl
- **phaser**: Multi-Phase Amp, Double Brit Phaser, Panning Swirl
- **tremolo**: Dyna-Trem, Old Time Tremolo, Surfin' in Stereo, Swampland, Cheap Studio Time
- **vibrato**: Vibrato Verb
- **chorus**: Mystery Chorus, Eighties Goth, Starlit Cavern
- **fuzz**: Indie Scorcher
- **octave / pitchshift**: Woolly Octave
- **tape-echo / pingpong (slapback & rhythmic delay)**: Chicken Pickin', Country Gent, Echo Studio, Clean Echoes, Dublin Delay
- **wah (cocked)**: Honk n' Drive
- **gate**: Chord Burner, Razor Amp
