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
  p('Amazing Tweed', 'Warm tweed on edge of breakup', [...TWEED(), reverb(0.4, 0.12)]),
  p('Brit and Clean', 'Chimey Vox-style clean', [...BRITCHIME({ drive: { amount: 1.5, midBump: 1 }, eq: { mid: 6, midFreq: 1800, treble: 6 } }), reverb(0.4, 0.12)]),
  p('Chicken Pickin\'', 'Snappy bright country twang', [comp(-22, 4, 4), ...BLACKFACE({ cab: { brightness: 7, body: 4 } }), tapeEcho(110, 0.15, 0.12), reverb(0.3, 0.1)]),
  p('Clean Echoes', 'Spacious rhythmic stereo echoes', [...BLACKFACE(), pingpong(380, 0.4, 0.3), reverb(0.6, 0.2)]),
  p('Clean Studio Stack', 'Big full-bodied clean stack', [...BRITCRUNCH({ drive: { amount: 0.5, blend: 0.25 }, eq: { bass: 6 }, cab: { brightness: 5, body: 7 } }), widener(4), reverb(0.4, 0.1)]),
  p('Cool Jazz Combo', 'Mellow warm neck-pickup jazz', [...BLACKFACE({ drive: { amount: 0 }, eq: { bass: 6, mid: 5, treble: 3 }, cab: { brightness: 2, body: 7 } }), reverb(0.4, 0.1)]),
  p('Country Gent', 'Bright twangy rockabilly slapback', [comp(-20, 3, 3), ...BLACKFACE({ eq: { treble: 7 }, cab: { brightness: 7, body: 4 } }), tapeEcho(130, 0.2, 0.15), reverb(0.35, 0.12)]),
  p('Dublin Delay', 'Rhythmic dotted-eighth ambience', [...BRITCHIME(), delay(375, 0.35, 0.4), widener(5), reverb(0.6, 0.18)]),
  p('Dyna-Trem', 'Pulsing amp tremolo clean', [...BLACKFACE(), tremolo(5, 0.6, 0), reverb(0.4, 0.12)]),
  p('Echo Studio', 'Studio clean with slap echoes', [...BLACKFACE(), tapeEcho(300, 0.45, 0.3, { tone: 4, flutter: 3 }), reverb(0.5, 0.15)]),
  p('Move the Mics', 'Natural room tone, minimal FX', [...BLACKFACE({ cab: { brightness: 5, body: 5 } }), reverb(0.5, 0.16)]),
  multiPhase,
  p('Mystery Chorus', 'Wide shimmering chorused clean', [...BLACKFACE(), chorus(0.8, 5, 0.45), widener(5), reverb(0.4, 0.12)]),
  p('Old Time Tremolo', 'Choppy old-school opto tremolo', [...TWEED(), tremolo(6, 0.85, 1), reverb(0.4, 0.12)]),
  spinSpeaker,
  surfin,
  vibratoVerb,
  p('Warm British Combo', 'Rounded warm British clean', [...BRITCHIME({ drive: { amount: 1 }, eq: { treble: 5 }, cab: { brightness: 4, body: 6 } }), reverb(0.4, 0.1)]),
  p('Worlds Smallest Amp', 'Boxy lo-fi tiny-Champ breakup', [...TWEED({ drive: { amount: 3.5, blend: 0.6, tone: 4 }, eq: { bass: 3, mid: 6, treble: 5 }, cab: { brightness: 3, body: 4 } }), reverb(0.25, 0.08)]),
];

// ── 02 / 03 Crunch & Distorted Guitar ───────────────────────────────────
const CRUNCH = [
  p('Amp Switcher', 'Blended clean + crunch amp', [...BRITCRUNCH({ drive: { amount: 4, blend: 0.5, midBump: 2 }, cab: { brightness: 5, body: 6 } }), delay(300, 0.2, 0.12)]),
  p('Big Brute Blues', 'Thick cranked bluesy crunch', [...TWEED({ drive: { amount: 5, tone: 5, blend: 0.8, midBump: 3 }, eq: { bass: 6, mid: 6, treble: 4 }, cab: { brightness: 4, body: 7 } }), reverb(0.4, 0.12)]),
  p('British Invasion', '60s jangle-crunch AC30 grind', [...BRITCHIME({ drive: { amount: 4, blend: 0.8, midBump: 2 }, eq: { mid: 6, midFreq: 1800, treble: 6 } }), reverb(0.35, 0.1)]),
  p('Broken Up Brit', 'Marshall edge-of-breakup crunch', [...BRITCRUNCH({ drive: { amount: 4.5, midBump: 3 }, cab: { brightness: 5, body: 6 } }), reverb(0.35, 0.1)]),
  p('Cheap Studio Time', 'Gritty cheap lo-fi grind', [...BRITCRUNCH({ drive: { amount: 5, tone: 4 }, eq: { treble: 4 }, cab: { brightness: 3, body: 4 } }), tremolo(4, 0.4, 0), reverb(0.4, 0.14)]),
  p('Chord Burner', 'Aggressive chord-driving distortion', [gate(2.5), ...MODERN({ drive: { amount: 7, midBump: 2 }, eq: { bass: 6, mid: 4, treble: 6 }, cab: { brightness: 5, body: 5 } }), delay(250, 0.18, 0.12)]),
  p('Double Brit Phaser', 'Phase-swirled double-Marshall', [...BRITCRUNCH({ drive: { amount: 5 } }), phaser(0.4, 6, 0.5, 0.5), delay(300, 0.2, 0.12)]),
  p('Double Driven', 'Stacked overdrive saturated lead', [boost(8, 4), ...MODERN({ drive: { amount: 7, midBump: 3 }, eq: { bass: 5, mid: 6, treble: 5 }, cab: { brightness: 5, body: 6 } }), reverb(0.3, 0.1)]),
  p('Eighties Goth', 'Dark atmospheric chorused wash', [...BRITCRUNCH({ drive: { amount: 6 }, eq: { treble: 5 }, cab: { brightness: 4, body: 6 } }), chorus(0.6, 6, 0.4), delay(450, 0.4, 0.3), reverb(0.7, 0.28)]),
  p('Fat Amp', 'Thick low-heavy fat crunch', [...BRITCRUNCH({ drive: { amount: 5 }, eq: { bass: 7, mid: 6, treble: 4 }, cab: { brightness: 4, body: 7 } }), reverb(0.3, 0.1)]),
  p('Heartbroken', 'Emotive sustaining lead crunch', [comp(-18, 3, 3), ...BRITCRUNCH({ drive: { amount: 5, midBump: 4 } }), delay(400, 0.35, 0.2), reverb(0.6, 0.2)]),
  p('Honk n\' Drive', 'Nasal midrange-honky overdrive', [wah(6, 8, 0.6), ...BRITCHIME({ drive: { amount: 4, blend: 0.75 }, eq: { mid: 7, midFreq: 1200 }, cab: { brightness: 6, body: 6 } }), reverb(0.3, 0.1)]),
  p('Indie Scorcher', 'Scrappy bright lo-fi indie distortion', [fuzz(4, 6, 4), ...BRITCRUNCH({ drive: { amount: 3, blend: 0.7 }, eq: { treble: 6 }, cab: { brightness: 5, body: 5 } }), reverb(0.3, 0.1)]),
  p('Old School Punk', 'Raw fast buzzsaw punk distortion', [...BRITCRUNCH({ drive: { amount: 6, tone: 7, midBump: 1 }, eq: { bass: 5, mid: 5, treble: 7 }, cab: { brightness: 6, body: 5 } }), reverb(0.25, 0.08)]),
  panningSwirl,
  p('Practice Space', 'Roomy garage practice-amp crunch', [...BRITCRUNCH({ drive: { amount: 4 }, cab: { brightness: 5, body: 5 } }), reverb(0.5, 0.22)]),
  p('Razor Amp', 'Sharp slicing tight high-gain', [gate(3), boost(4, 5), ...MODERN({ drive: { amount: 8, tone: 7, midBump: 1 }, eq: { bass: 6, mid: 4, treble: 7 }, cab: { brightness: 6, body: 5 } }), reverb(0.25, 0.08)]),
  p('Royal Rock', 'Classic British arena-rock crunch', [...BRITCRUNCH({ drive: { amount: 5, midBump: 3 } }), delay(350, 0.25, 0.12), reverb(0.4, 0.14)]),
  p('Starlit Cavern', 'Spacious cavernous ambient distortion', [...MODERN({ drive: { amount: 6 } }), chorus(0.5, 4, 0.3), delay(500, 0.45, 0.32), widener(6), reverb(0.9, 0.35)]),
  p('Swampland', 'Swampy southern tremolo-crunch', [...TWEED({ drive: { amount: 5, tone: 4, blend: 0.8 }, cab: { brightness: 4, body: 7 } }), tremolo(4, 0.6, 0), reverb(0.45, 0.16)]),
  woollyOctave,
];

export const GB_PRESETS = [
  ...CLEAN.map((x) => ({ ...x, category: 'clean' })),
  ...CRUNCH.map((x) => ({ ...x, category: 'crunch' })),
];
