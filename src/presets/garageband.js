// src/presets/garageband.js
// GarageBand patch recipes reproduced with our effect registry.
// See docs/garageband-patch-recipes.md for the source recipes and the
// amp-voicing cheat-sheet these helpers encode.
import surfin from './gb-surfin-stereo.json' with { type: 'json' };
import spinSpeaker from './gb-spin-speaker-blues.json' with { type: 'json' };
import vibratoVerb from './gb-vibrato-verb.json' with { type: 'json' };
import multiPhase from './gb-multi-phase-amp.json' with { type: 'json' };
import panningSwirl from './gb-panning-swirl.json' with { type: 'json' };
import woollyOctave from './gb-woolly-octave.json' with { type: 'json' };

// ── Node helpers (defaults match each effect's schema) ──────────────────
const drive = (p = {}) => ({ type: 'drive', params: { amount: 2.5, tone: 5, level: 5, blend: 0.6, midBump: 0, ...p } });
const eq = (p = {}) => ({ type: 'eq', params: { bass: 5, mid: 5, midFreq: 750, treble: 5, ...p } });
const cab = (p = {}) => ({ type: 'cabinet', params: { brightness: 4, body: 6, mix: 1, ...p } });

const comp = (threshold, ratio, makeup, p = {}) => ({ type: 'compressor', params: { threshold, ratio, attack: 0.005, release: 0.22, makeup, ...p } });
const gate = (threshold, p = {}) => ({ type: 'gate', params: { threshold, release: 4, ...p } });
const boost = (gain, tight, p = {}) => ({ type: 'boost', params: { gain, tilt: 5, tight, ...p } });
const fuzz = (f, tone, level) => ({ type: 'fuzz', params: { fuzz: f, tone, level } });
const octave = (oct, f, tone, level) => ({ type: 'octave', params: { octave: oct, fuzz: f, tone, level } });
const wah = (position, resonance, mix) => ({ type: 'wah', params: { position, resonance, mix } });

const chorus = (rate, depth, mix) => ({ type: 'chorus', params: { rate, depth, mix } });
const phaser = (rate, depth, mix, feedback = 0.4) => ({ type: 'phaser', params: { rate, depth, feedback, mix } });
const tremolo = (rate, depth, shape = 0) => ({ type: 'tremolo', params: { rate, depth, shape } });
const vibrato = (rate, depth) => ({ type: 'vibrato', params: { rate, depth } });
const rotary = (speed, depth, mix) => ({ type: 'rotary', params: { speed, depth, mix } });
const autopan = (rate, depth, shape = 0) => ({ type: 'autopan', params: { rate, depth, shape } });

const delay = (time, feedback, mix, tone = 4) => ({ type: 'delay', params: { time, feedback, tone, mix } });
const tapeEcho = (time, feedback, mix, { tone = 4, flutter = 3 } = {}) => ({ type: 'tape-echo', params: { time, feedback, tone, flutter, mix } });
const pingpong = (time, feedback, mix, tone = 5) => ({ type: 'pingpong', params: { time, feedback, tone, mix } });
const reverb = (size, mix) => ({ type: 'reverb', params: { size, mix } });
const widener = (width) => ({ type: 'widener', params: { width } });

// ── Amp voicings → [drive, eq, cabinet]; pass overrides per node ─────────
const TWEED = (o = {}) => [drive({ amount: 2.5, blend: 0.45, tone: 5, ...o.drive }), eq({ bass: 6, mid: 6, treble: 4, midFreq: 700, ...o.eq }), cab({ brightness: 3, body: 7, ...o.cab })];
const BLACKFACE = (o = {}) => [drive({ amount: 0.5, blend: 0.3, ...o.drive }), eq({ bass: 5, mid: 4, treble: 7, midFreq: 600, ...o.eq }), cab({ brightness: 7, body: 4, ...o.cab })];
const BRITCHIME = (o = {}) => [drive({ amount: 2, blend: 0.4, ...o.drive }), eq({ bass: 5, mid: 6, treble: 6, midFreq: 1800, ...o.eq }), cab({ brightness: 6, body: 6, ...o.cab })];
const BRITCRUNCH = (o = {}) => [drive({ amount: 5, blend: 0.85, midBump: 3, ...o.drive }), eq({ bass: 5, mid: 6, treble: 5, midFreq: 750, ...o.eq }), cab({ brightness: 5, body: 6, ...o.cab })];
const MODERN = (o = {}) => [drive({ amount: 8, blend: 0.95, ...o.drive }), eq({ bass: 6, mid: 4, treble: 6, midFreq: 800, ...o.eq }), cab({ brightness: 5, body: 5, ...o.cab })];

const p = (name, song, chain) => ({ name, artist: 'GarageBand', song, chain });

// ── 01 Clean Guitar ─────────────────────────────────────────────────────
const CLEAN = [
  p('Tears in Tweed', 'Warm tweed on edge of breakup', [...TWEED(), reverb(0.4, 0.12)]),
  p('Ticket to Chime', 'Chimey Vox-style clean', [...BRITCHIME({ drive: { amount: 1.5, midBump: 1 }, eq: { mid: 6, midFreq: 1800, treble: 6 } }), reverb(0.4, 0.12)]),
  p('Folsom Twang', 'Snappy bright country twang', [comp(-22, 4, 4), ...BLACKFACE({ cab: { brightness: 7, body: 4 } }), tapeEcho(110, 0.15, 0.12), reverb(0.3, 0.1)]),
  // GB: Small Tweed combo, bright (Tone 0.72), squashed comp, spring verb.
  p('Shine On Clean', 'Spacious rhythmic stereo echoes', [comp(-20, 4, 4), ...TWEED({ drive: { amount: 4, tone: 7 }, eq: { treble: 6 }, cab: { brightness: 5 } }), pingpong(380, 0.4, 0.28), reverb(0.5, 0.14)]),
  p('Every Breath Stack', 'Big full-bodied clean stack', [...BRITCRUNCH({ drive: { amount: 0.5, blend: 0.25 }, eq: { bass: 6 }, cab: { brightness: 5, body: 7 } }), widener(4), reverb(0.4, 0.1)]),
  p('Kind of Mellow', 'Mellow warm neck-pickup jazz', [...BLACKFACE({ drive: { amount: 0 }, eq: { bass: 6, mid: 5, treble: 3 }, cab: { brightness: 2, body: 7 } }), reverb(0.4, 0.1)]),
  // GB: Small Tweed combo (not blackface), bright twang cab, slapback echo.
  p('Mystery Train', 'Bright twangy rockabilly slapback', [comp(-20, 3, 3), ...TWEED({ drive: { amount: 4.8, tone: 5 }, eq: { treble: 7 }, cab: { brightness: 7, body: 4 } }), tapeEcho(130, 0.2, 0.15), reverb(0.35, 0.12)]),
  p('Streets Have Echoes', 'Rhythmic dotted-eighth ambience', [...BRITCHIME(), delay(375, 0.35, 0.4), widener(5), reverb(0.6, 0.18)]),
  p('Soon Is Now', 'Pulsing amp tremolo clean', [...BLACKFACE(), tremolo(5, 0.6, 0), reverb(0.4, 0.12)]),
  // GB: Small Tweed combo with heavy tape echo.
  p('Sun Studio Slap', 'Studio clean with slap echoes', [...TWEED({ drive: { amount: 4, tone: 5 }, eq: { treble: 5 } }), tapeEcho(300, 0.45, 0.3, { tone: 4, flutter: 3 }), reverb(0.45, 0.12)]),
  // GB: Small Tweed combo, bright, big church reverb (Reverb 0.46).
  p('Hallelujah Tweed', 'Angelic big-reverb clean tweed', [...TWEED({ drive: { amount: 2.5, tone: 6 }, eq: { treble: 5 } }), reverb(0.85, 0.3)]),
  // GB: Vintage British Stack mic'd clean (Room/Close mic blend) — clean Marshall.
  p('Levee Room', 'Natural room tone, minimal FX', [...BRITCRUNCH({ drive: { amount: 1, blend: 0.3 }, eq: { mid: 5 }, cab: { brightness: 5, body: 6, presence: 6 } }), reverb(0.6, 0.18)]),
  multiPhase,
  // GB: Small Tweed combo, pushed (Gain 0.69), deep chorus + big spring (0.5).
  p('Nevermind Shimmer', 'Wide shimmering chorused clean', [...TWEED({ drive: { amount: 5, tone: 5, blend: 0.6 } }), chorus(0.8, 6, 0.45), widener(5), reverb(0.5, 0.16)]),
  // GB: Blackface (Face Amp) with the opto Tremolo pedal, fast rate.
  p('Crimson Clover', 'Choppy old-school opto tremolo', [...BLACKFACE({ drive: { amount: 2, tone: 5 } }), tremolo(6, 0.85, 1), reverb(0.4, 0.12)]),
  spinSpeaker,
  surfin,
  vibratoVerb,
  p('Norwegian Warmth', 'Rounded warm British clean', [...BRITCHIME({ drive: { amount: 1 }, eq: { treble: 5 }, cab: { brightness: 4, body: 6 } }), reverb(0.4, 0.1)]),
  // GB: British Combo (boxy Vox), deep chorus (0.97) + fuzz, lo-fi.
  p('Chamber Lo-Fi', 'Boxy lo-fi tiny-Champ breakup', [...BRITCHIME({ drive: { amount: 3.5, blend: 0.6, tone: 4 }, eq: { bass: 3, mid: 6, treble: 5 }, cab: { brightness: 3, body: 4 } }), chorus(0.7, 7, 0.4), reverb(0.25, 0.08)]),
];

// ── 02 / 03 Crunch & Distorted Guitar ───────────────────────────────────
const CRUNCH = [
  p('Jekyll & Hyde', 'Blended clean + crunch amp', [...BRITCRUNCH({ drive: { amount: 4, blend: 0.5, midBump: 2 }, cab: { brightness: 5, body: 6 } }), delay(300, 0.2, 0.12)]),
  p('La Grange Growl', 'Thick cranked bluesy crunch', [...TWEED({ drive: { amount: 5, tone: 5, blend: 0.8, midBump: 3 }, eq: { bass: 6, mid: 6, treble: 4 }, cab: { brightness: 4, body: 7 } }), reverb(0.4, 0.12)]),
  p('Day Tripper Grind', '60s jangle-crunch AC30 grind', [...BRITCHIME({ drive: { amount: 4, blend: 0.8, midBump: 2 }, eq: { mid: 6, midFreq: 1800, treble: 6 } }), reverb(0.35, 0.1)]),
  // GB: British Combo (Vox AC30, not Marshall) cranked to the edge (Gain 1.0).
  p('Generation Edge', 'Vox AC30 edge-of-breakup crunch', [...BRITCHIME({ drive: { amount: 6, blend: 0.85, midBump: 2 }, eq: { mid: 6, treble: 5 }, cab: { brightness: 5, body: 6 } }), reverb(0.35, 0.12)]),
  p('Spirit in the Grit', 'Gritty cheap lo-fi grind', [...BRITCRUNCH({ drive: { amount: 5, tone: 4 }, eq: { treble: 4 }, cab: { brightness: 3, body: 4 } }), tremolo(4, 0.4, 0), reverb(0.4, 0.14)]),
  p('Teen Spirit Burner', 'Aggressive chord-driving distortion', [gate(2.5), ...MODERN({ drive: { amount: 7, midBump: 2 }, eq: { bass: 6, mid: 4, treble: 6 }, cab: { brightness: 5, body: 5 } }), delay(250, 0.18, 0.12)]),
  p('Eruption Swirl', 'Phase-swirled double-Marshall', [...BRITCRUNCH({ drive: { amount: 5 } }), phaser(0.4, 6, 0.5, 0.5), delay(300, 0.2, 0.12)]),
  // GB: British Combo (Vox) driven hard (Gain 0.91) + stacked boost.
  p('Comfortably Driven', 'Stacked overdrive saturated lead', [boost(8, 4), ...BRITCHIME({ drive: { amount: 6.5, blend: 0.9, midBump: 3 }, eq: { mid: 6, treble: 5 }, cab: { brightness: 5, body: 6 } }), reverb(0.35, 0.12)]),
  // GB: British Combo (Vox) dark crunch, chorus + long delay wash.
  p('Disintegration Wash', 'Dark atmospheric chorused wash', [...BRITCHIME({ drive: { amount: 4.5, blend: 0.8, midBump: 2 }, eq: { treble: 5 } }), chorus(0.6, 6, 0.4), delay(450, 0.4, 0.3), reverb(0.7, 0.28)]),
  // GB: Blackface (Face Amp) pushed fat, bright (Tone 0.69), big body.
  p('Sabbath Lows', 'Thick low-heavy fat crunch', [...BLACKFACE({ drive: { amount: 5, blend: 0.7 }, eq: { bass: 7, mid: 6, treble: 6 }, cab: { brightness: 5, body: 7 } }), reverb(0.3, 0.12)]),
  p('Parisienne Cry', 'Emotive sustaining lead crunch', [comp(-18, 3, 3), ...BRITCRUNCH({ drive: { amount: 5, midBump: 4 } }), delay(400, 0.35, 0.2), reverb(0.6, 0.2)]),
  // GB: Small Tweed combo cranked (Gain 1.0) + boost + honky midrange.
  p('Voodoo Honk', 'Nasal midrange-honky overdrive', [wah(6, 8, 0.5), boost(3, 5), ...TWEED({ drive: { amount: 6, tone: 5, blend: 0.85, midBump: 3 }, eq: { mid: 7, midFreq: 1200 }, cab: { brightness: 5, body: 6 } }), reverb(0.3, 0.1)]),
  p('Debaser Fuzz', 'Scrappy bright lo-fi indie distortion', [fuzz(4, 6, 4), ...BRITCRUNCH({ drive: { amount: 3, blend: 0.7 }, eq: { treble: 6 }, cab: { brightness: 5, body: 5 } }), reverb(0.3, 0.1)]),
  p('Blitzkrieg Buzz', 'Raw fast buzzsaw punk distortion', [...BRITCRUNCH({ drive: { amount: 6, tone: 7, midBump: 1 }, eq: { bass: 5, mid: 5, treble: 7 }, cab: { brightness: 6, body: 5 } }), reverb(0.25, 0.08)]),
  panningSwirl,
  p('Basement Tapes', 'Roomy garage practice-amp crunch', [...BRITCRUNCH({ drive: { amount: 4 }, cab: { brightness: 5, body: 5 } }), reverb(0.5, 0.22)]),
  // GB: Blackface (Face Amp) platform driven to razor gain (Drive 1.0) + wah.
  p('Rage Razor', 'Sharp slicing tight high-gain', [gate(3), boost(6, 6), wah(7, 7, 0.4), ...BLACKFACE({ drive: { amount: 6, tone: 7, blend: 0.9, midBump: 1 }, eq: { treble: 7 }, cab: { brightness: 6, body: 5 } }), reverb(0.3, 0.1)]),
  // GB: British Combo (Vox) cranked (Gain 0.91) arena rock + wah + delay.
  p('Bohemian Crunch', 'Classic British arena-rock crunch', [...BRITCHIME({ drive: { amount: 6, blend: 0.88, midBump: 3 }, eq: { mid: 6, treble: 5 }, cab: { brightness: 5, body: 6 } }), delay(350, 0.25, 0.12), reverb(0.4, 0.14)]),
  p('Moonage Cavern', 'Spacious cavernous ambient distortion', [...MODERN({ drive: { amount: 6 } }), chorus(0.5, 4, 0.3), delay(500, 0.45, 0.32), widener(6), reverb(0.9, 0.35)]),
  p('Bayou Rising', 'Swampy southern tremolo-crunch', [...TWEED({ drive: { amount: 5, tone: 4, blend: 0.8 }, cab: { brightness: 4, body: 7 } }), tremolo(4, 0.6, 0), reverb(0.45, 0.16)]),
  woollyOctave,
];

export const GB_PRESETS = [
  ...CLEAN.map((x) => ({ ...x, category: 'clean' })),
  ...CRUNCH.map((x) => ({ ...x, category: 'crunch' })),
];
