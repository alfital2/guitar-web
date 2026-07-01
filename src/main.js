// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset, GB_CATEGORIES } from './presets.js';
import { renderPresetBrowser } from './preset-browser.js';
import { renderPedalboard } from './chain-ui/pedalboard.js';
import { renderAmp } from './chain-ui/amp.js';
import { createCalibrationEq } from './calibration/calibration-eq.js';
import { computeCorrection } from './calibration/correction.js';
import { bandPowersFromMagnitudes } from './calibration/bands.js';
import { createAccumulator, accumulate, fingerprint, coverage } from './calibration/analyzer.js';
import * as profiles from './calibration/profiles.js';
import { renderCalibrationControls } from './calibration/ui.js';
import { detectPitchMPM } from './pitch/mpm.js';
import { freqToNote, noteLabel } from './pitch/note.js';
import { fingerprintToStats, archetype } from './profile-card/attributes.js';
import { renderProfileCard } from './profile-card/ui.js';
import { measureLoudnessGain, isNeuralChain } from './normalize.js';
import { mountTransport } from './transport-ui.js';
import { renderTrackLane, PX_PER_SEC, getSelectedClips, clearClipSelection } from './track-lane.js';
import { punchTakes } from './take-ops.js';
import { createRecorder } from './recorder.js';
import { createPlayer } from './player.js';
import { drawWaveform } from './waveform.js';
import { cloneTake, splitTakeAt, resolveNoOverlap } from './clip-ops.js';
import * as chainState from './chain-state.js';
import * as chainStore from './chain-store.js';
import { loadWorklets } from './effects/worklets/index.js';
import * as reverbFx from './effects/reverb.js';
import { connectInputChannel } from './audio/input-channel.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut, normGain, analyser, rafId;
// Reverb lives in the amp now (post-pedalboard, always on), not as a pedal.
const REVERB_ID = '__amp_reverb__';
let ampReverb = { size: 0.4, mix: 0 }; // amp reverb params (size, wet mix)
let ampCollapsed = chainStore.loadAmpCollapsed(); // amp folded to value strip
let reverbStage = null;                // audio node: engine.output -> reverbStage -> normGain
let calibrationEq, calibRAF, calibState, calibCountdown;
let inputSplitter = null;   // ChannelSplitterNode after source; picks a hardware input channel
let inputChannel = 0;       // selected input channel: 0 = input 1, 1 = input 2 (persists across power cycles)
let pitchBuf, lastNoteMs = 0;
let prevBars = null;
let accentRGB = '240,180,41'; // current theme accent for canvas drawing

let tracks = [];         // [{ id, name, armed, takes: [] }]
let nextTrackId = 1;     // track id source
let armedId = null;      // the record-armed track
let takeSeq = 0;         // running take number for clip labels (global)
let liveRAF = null, liveClip = null; // in-progress (growing) recording clip
let recStartX = 0;                   // px x-position where the current take began
// Tap normGain (post loudness-normalization, pre Vol) so the take matches what
// you hear and is independent of the master Vol slider.
const recorder = createRecorder({ getSource: () => normGain, getContext: () => ctx });
const player = createPlayer();

const armedTrack = () => tracks.find((t) => t.id === armedId) || null;
const allTakes = () => tracks.flatMap((t) => t.takes);
const newTrack = (name) => ({ id: nextTrackId++, name: name || 'Track', armed: false, takes: [], volume: 0.8, pan: 0, mute: false, solo: false, patch: null });
// Effective playback gain for a track given the global solo state.
function trackGain(t, anySolo) { return anySolo ? (t.solo ? t.volume : 0) : (t.mute ? 0 : t.volume); }
function buildGroups() {
  const anySolo = tracks.some((t) => t.solo);
  return tracks.map((t) => ({ id: t.id, takes: t.takes, gain: trackGain(t, anySolo), pan: t.pan }));
}
// Push current mixer state to the player while it's playing.
function syncMix() {
  if (!player.isPlaying()) return;
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) { player.setTrackGain(t.id, trackGain(t, anySolo)); player.setTrackPan(t.id, t.pan); }
}

// ── Undo / redo (snapshots of the tracks model) ──
// Sample buffers are immutable (ops create new arrays), so snapshots copy the
// structure but share the Float32Arrays — cheap and safe.
let undoStack = [], redoStack = [];
function snapshot() {
  return { tracks: tracks.map((t) => ({ ...t, takes: t.takes.map((k) => ({ ...k })) })), armedId, takeSeq, nextTrackId };
}
function restore(s) {
  tracks = s.tracks.map((t) => ({ ...t, takes: t.takes.map((k) => ({ ...k })) }));
  armedId = s.armedId; takeSeq = s.takeSeq; nextTrackId = s.nextTrackId;
  renderTrack(); updateTransport();
}
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); redoStack = []; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
  if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || ''))) return; // don't hijack text fields
  e.preventDefault();
  if (e.shiftKey) redo(); else undo();
});

// Delete / Backspace removes the selected clips (Cmd/Ctrl+click to multi-select).
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return;
  if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
  const sel = getSelectedClips();
  if (!sel.length) return;
  e.preventDefault();
  pushUndo();
  for (const it of sel) { const t = tracks.find((k) => k.id === it.trackId); if (t) t.takes = t.takes.filter((k) => k.n !== it.n); }
  clearClipSelection();
  renderTrack(); updateTransport();
});

// ── Clip clipboard + ops (right-click menu) ──
let clipboard = null;
function copyClip(trackId, n) {
  const t = tracks.find((k) => k.id === trackId); const tk = t && t.takes.find((k) => k.n === n);
  if (tk) clipboard = cloneTake(tk);
}
function pasteClip(trackId) {
  if (!clipboard) return;
  const t = tracks.find((k) => k.id === trackId) || armedTrack();
  if (!t) return;
  pushUndo();
  const w = clipWidth(clipboard);
  const x = Math.max(0, Math.round(resolveNoOverlap(t.takes.map((k) => ({ x: k.x, w: clipWidth(k) })), snapPx(playheadSec * PX_PER_SEC), w)));
  t.takes.push({ ...cloneTake(clipboard), n: ++takeSeq, x });
  renderTrack(); updateTransport();
}
function splitClip(trackId, n) {
  const t = tracks.find((k) => k.id === trackId); if (!t) return;
  const i = t.takes.findIndex((k) => k.n === n); if (i < 0) return;
  const tk = t.takes[i];
  const res = splitTakeAt(tk, playheadSec - (tk.x || 0) / PX_PER_SEC, takeSeq + 1, PX_PER_SEC);
  if (res) { pushUndo(); takeSeq++; t.takes.splice(i, 1, ...res); renderTrack(); }
}
function deleteClips(items) {
  if (!items || !items.length) return;
  pushUndo();
  for (const it of items) { const t = tracks.find((k) => k.id === it.trackId); if (t) t.takes = t.takes.filter((k) => k.n !== it.n); }
  clearClipSelection();
  renderTrack(); updateTransport();
}
function deleteClip(trackId, n) { deleteClips([{ trackId, n }]); }

let ctxMenu = null;
function closeCtxMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }
function ctxItem(label, fn, disabled) {
  const b = document.createElement('button'); b.className = 'ctx-item'; b.textContent = label;
  if (disabled) b.disabled = true; else b.addEventListener('click', () => { fn(); closeCtxMenu(); });
  return b;
}
function openCtxMenu(x, y, items) {
  closeCtxMenu();
  const m = document.createElement('div'); m.className = 'ctx-menu';
  m.style.left = `${x}px`; m.style.top = `${y}px`;
  items.forEach((it) => m.appendChild(it));
  document.body.appendChild(m);
  // keep it on-screen horizontally
  const r = m.getBoundingClientRect();
  if (r.right > window.innerWidth) m.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`;
  ctxMenu = m;
}
document.addEventListener('click', closeCtxMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCtxMenu(); });
let playheadSec = 0;
// Move the playhead to a time position (seconds) on the track lane.
function setPlayhead(sec) {
  playheadSec = Math.max(0, sec || 0);
  const ph = $('track-lane') && $('track-lane').querySelector('.track-playhead');
  if (ph) ph.style.left = `${playheadSec * PX_PER_SEC}px`;
}
// Enable play/skip once there is something to play.
// Reflect playback state on the play button: ▶ when stopped, ⏸ while playing.
function reflectPlay() {
  const pb = $('tp-play'); if (!pb) return;
  const p = player.isPlaying();
  pb.classList.toggle('on', p);
  pb.textContent = p ? '⏸' : '▶';
  pb.title = p ? 'Pause' : 'Play';
}
function updateTransport() {
  const has = allTakes().length > 0;
  const play = $('tp-play'), skip = $('tp-start');
  if (play) { play.disabled = !has; play.title = has ? 'Play' : 'Play — record something first'; }
  // Skip-to-start just parks the playhead at bar 1 — available whenever powered.
  if (skip) { skip.disabled = !ctx; skip.title = ctx ? 'Skip to start' : 'Skip to start — power on first'; }
}
// Remove the growing in-progress clip (on stop or teardown).
function clearLiveClip() {
  if (liveRAF) { cancelAnimationFrame(liveRAF); liveRAF = null; }
  if (liveClip) { liveClip.remove(); liveClip = null; }
}
let currentChain = [];   // array of units (chain-state model) — source of truth
let nextId = 1;          // monotonic instanceId source
let normTimer = null;    // debounce handle for loudness re-measure
let normSig = null;      // last-measured chain structure signature
let currentNormDb = null; // fixed loudness offset for neural presets — the offline
                          // measure can't load their wasm+model (design §7)

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

// Liquid-glass surfaces use `backdrop-filter: url(#svg-filter)` for refraction,
// which Safari doesn't support — enable only off Safari (gated by html.liquid).
if (!isSafari) document.documentElement.classList.add('liquid');

$('safari-warn').style.display = hasSetSinkId ? 'none' : 'block';

// The artist chain is fed by the calibration EQ (source -> calibrationEq -> engine).
// We never disconnect `source` here, so the analyser tap and calibration EQ stay live
// across preset switches.
// Default schema params for a type, used when adding an effect.
function defaultParams(type) {
  const out = {};
  for (const p of registry[type].schema.params) out[p.key] = p.default;
  return out;
}

// Build the locked (amp-head) module list and the full pedalboard list from the
// current chain, then (re)build the audio graph if audio is running. Editing
// works before Start too — then only the model + UI update.
function rebuildGraph() {
  const view = currentChain.map((u) => ({ ...u, schema: registry[u.type].schema }));
  const locked = view.filter((u) => u.locked);

  if (ctx) {
    if (engine) {
      try { calibrationEq.output.disconnect(); } catch {}
      try { engine.output.disconnect(); } catch {}
    }
    engine = buildChain(ctx, chainState.toEngineChain(currentChain), registry);
    if (calibrationEq) calibrationEq.output.connect(engine.input);
    // Pedalboard feeds the amp reverb stage, which feeds normGain.
    if (reverbStage) { reverbStage.apply(ampReverb); engine.output.connect(reverbStage.input); }
    else if (normGain) engine.output.connect(normGain);
  }

  // The amp head also hosts the always-on reverb (rendered as a synthetic module
  // so it reuses the amp-knob UI), placed after the drive/eq/cabinet groups.
  const ampModules = [...locked, { instanceId: REVERB_ID, schema: reverbFx.schema, params: ampReverb }];
  try {
    renderAmp($('amp'), ampModules, onAmpParam, {
      collapsed: ampCollapsed,
      onCollapse: (c) => { ampCollapsed = c; chainStore.saveAmpCollapsed(c); },
    });
    renderPedalboard($('chain'), view, {
      onParamChange: setParamLive,
      onAdd: addEffect,
      onRemove: removeEffect,
      onMove: moveEffect,
      onToggleBypass: toggleBypass,
    });
  } catch (e) {
    $('error').textContent = 'render: ' + e.message;
    console.error(e);
  }

  chainStore.save(currentChain);
  scheduleNormalize();
}

function setParamLive(instanceId, key, value) {
  currentChain = chainState.setParam(currentChain, instanceId, key, value);
  if (engine) {
    const idx = currentChain.findIndex((u) => u.instanceId === instanceId);
    if (idx >= 0) engine.setParam(idx, key, value);
  }
  chainStore.save(currentChain);
}

// Amp knob changes. The reverb group routes to the amp reverb stage; all other
// amp groups (drive/eq/cabinet) are normal locked chain modules.
function onAmpParam(instanceId, key, value) {
  if (instanceId === REVERB_ID) {
    ampReverb = { ...ampReverb, [key]: value };
    if (reverbStage) reverbStage.apply(ampReverb);
    chainStore.saveReverb(ampReverb);
    scheduleNormalize(); // wet mix changes output loudness
    return;
  }
  setParamLive(instanceId, key, value);
}

// Reverb is no longer a pedal: pull any reverb entries out of a preset/saved
// chain and fold them into the amp reverb (last one wins; none → reverb off).
function extractReverb(chainData) {
  const rev = chainData.filter((e) => e.type === 'reverb');
  return {
    rest: chainData.filter((e) => e.type !== 'reverb'),
    reverb: rev.length ? { size: 0.4, mix: 0.12, ...rev[rev.length - 1].params } : null,
  };
}

function addEffect(type, beforeId) {
  if (!registry[type]) { $('error').textContent = `"${type}" not available yet`; return; }
  const newId = nextId;
  const r = chainState.add(currentChain, type, defaultParams(type), nextId);
  let chain = r.chain; nextId = r.nextId;
  // Insert at a drop position when dragged onto the board; else append.
  if (beforeId != null) {
    const target = chain.findIndex((u) => u.instanceId === beforeId);
    chain = chainState.move(chain, newId, target < 0 ? chain.length : target);
  }
  currentChain = chain;
  rebuildGraph();
}

function removeEffect(instanceId) {
  currentChain = chainState.remove(currentChain, instanceId);
  rebuildGraph();
}

function toggleBypass(instanceId) {
  currentChain = chainState.toggleBypass(currentChain, instanceId);
  rebuildGraph();
}

function moveEffect(instanceId, beforeInstanceId) {
  const target = beforeInstanceId == null
    ? currentChain.length
    : currentChain.findIndex((u) => u.instanceId === beforeInstanceId);
  currentChain = chainState.move(currentChain, instanceId, target < 0 ? currentChain.length : target);
  rebuildGraph();
}

let activePresetName = null;
function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  const { rest, reverb } = extractReverb(preset.chain);
  ampReverb = reverb || { size: 0.4, mix: 0 };
  chainStore.saveReverb(ampReverb);
  const r = chainState.fromPreset(rest, nextId);
  currentChain = r.chain; nextId = r.nextId;
  activePresetName = preset.name;
  // Neural presets ship a fixed, pre-measured normDb (applied in scheduleNormalize).
  currentNormDb = typeof preset.normDb === 'number' ? preset.normDb : null;
  rebuildGraph();
  saveTrackPatch(armedTrack()); // the armed track now owns this preset
  renderBrowser();
  renderTrack();
  setPresets(false); // close the drawer after picking (narrow screens)
}

// ── Per-track patch (each track remembers its own amp/effects preset) ──
// A "patch" is the current chain + amp reverb + preset name. Captured when you
// leave a track and restored when you return to it.
function captureChainData() {
  return currentChain.map((u) => ({ type: u.type, params: { ...u.params }, bypassed: !!u.bypassed }));
}
function saveTrackPatch(track) {
  if (!track) return;
  track.patch = { chain: captureChainData(), reverb: { ...ampReverb }, name: activePresetName };
}
function loadTrackPatch(track) {
  if (!track || !track.patch) return false;
  const p = track.patch;
  ampReverb = p.reverb ? { ...p.reverb } : { size: 0.4, mix: 0 };
  chainStore.saveReverb(ampReverb);
  const r = chainState.fromPreset(p.chain.filter((e) => registry[e.type]), nextId);
  currentChain = r.chain; nextId = r.nextId;
  activePresetName = p.name || null;
  currentNormDb = null; // track patches don't persist normDb; neural falls back to unity
  rebuildGraph();
  renderBrowser();
  return true;
}

function renderBrowser() {
  const el = $('preset-browser');
  if (el) renderPresetBrowser(el, GB_CATEGORIES, loadPreset, activePresetName, () => setPresetsHidden(true));
}

let snapOn = true;
const SNAP_PX = 16; // one beat (0.5s @ 120 BPM 4/4) at 32 px/sec
// Hold Ctrl to bypass snapping entirely (free, sub-pixel-precise placement).
function snapPx(x, free) { return (snapOn && !free) ? Math.round(x / SNAP_PX) * SNAP_PX : x; }
// Visible/played length of a take in seconds — `len` once trimmed, else the full
// recorded `duration`. `offset` is how far into the samples playback starts.
const clipLen = (tk) => (tk.len != null ? tk.len : (tk.duration || 0));
const clipWidth = (tk) => Math.max(8, Math.round(clipLen(tk) * PX_PER_SEC));

// Overwrite the audio under a new take [newStart, newEnd] on its track.
function punchOver(track, newStart, newEnd) {
  if (!track) return;
  const r = punchTakes(track.takes, newStart, newEnd, takeSeq + 1);
  track.takes = r.takes; takeSeq = r.nextN - 1;
}
const occupiedExcept = (track, n) => track.takes.filter((k) => k.n !== n).map((k) => ({ x: k.x, w: clipWidth(k) }));

function renderTrack() {
  const el = $('track-lane');
  if (!el) return;
  renderTrackLane(el, {
    tracks,
    armedId,
    snap: snapOn,
    playheadSec,
    onToggleSnap: () => { snapOn = !snapOn; renderTrack(); },
    onAddTrack: () => {
      pushUndo();
      saveTrackPatch(armedTrack());            // persist the current track's patch
      const t = newTrack(activePresetName);
      t.patch = { chain: captureChainData(), reverb: { ...ampReverb }, name: activePresetName }; // new track starts as a copy of the current sound
      tracks.forEach((k) => { k.armed = false; });
      t.armed = true; armedId = t.id; tracks.push(t);
      renderTrack();
    },
    onMute: (id) => { const t = tracks.find((k) => k.id === id); if (t) { pushUndo(); t.mute = !t.mute; syncMix(); renderTrack(); } },
    onSolo: (id) => { const t = tracks.find((k) => k.id === id); if (t) { pushUndo(); t.solo = !t.solo; syncMix(); renderTrack(); } },
    onVolume: (id, v) => { const t = tracks.find((k) => k.id === id); if (t) { t.volume = v; if (player.isPlaying()) { const anySolo = tracks.some((k) => k.solo); player.setTrackGain(id, trackGain(t, anySolo)); } } },
    onPan: (id, p) => { const t = tracks.find((k) => k.id === id); if (t) { t.pan = p; if (player.isPlaying()) player.setTrackPan(id, p); } },
    onRemoveTrack: (id) => {
      pushUndo();
      const removingArmed = armedId === id;
      tracks = tracks.filter((t) => t.id !== id);
      if (removingArmed) {
        armedId = tracks.length ? tracks[tracks.length - 1].id : null;
        loadTrackPatch(armedTrack()); // restore the newly-armed track's patch
      }
      tracks.forEach((t) => { t.armed = t.id === armedId; });
      renderTrack(); updateTransport();
    },
    // Switching tracks saves the current track's patch and restores the target's.
    onArm: (id) => {
      if (id === armedId) return;
      saveTrackPatch(armedTrack());
      armedId = id;
      tracks.forEach((t) => { t.armed = t.id === id; });
      loadTrackPatch(armedTrack());
      renderTrack();
    },
    onRename: (id, name) => { const t = tracks.find((k) => k.id === id); if (t) { pushUndo(); t.name = name; renderTrack(); } },
    onMoveClip: (trackId, n, x, free) => {
      const t = tracks.find((k) => k.id === trackId); const tk = t && t.takes.find((k) => k.n === n);
      if (tk) { pushUndo(); tk.x = Math.max(0, Math.round(resolveNoOverlap(occupiedExcept(t, n), snapPx(x, free), clipWidth(tk)))); renderTrack(); }
    },
    // Trim a clip by dragging an edge: non-destructive (offset into samples + len).
    onTrimClip: (trackId, n, offset, len, x) => {
      const t = tracks.find((k) => k.id === trackId); const tk = t && t.takes.find((k) => k.n === n);
      if (tk) { pushUndo(); tk.offset = Math.max(0, offset); tk.len = Math.max(0.05, len); tk.x = Math.max(0, Math.round(x)); renderTrack(); }
    },
    // Group move: each clip avoids overlapping the clips that AREN'T moving, but
    // moving clips don't fight each other. One undo, one re-render.
    onMoveClips: (moves, free) => {
      if (!moves || !moves.length) return;
      pushUndo();
      const moving = new Set(moves.map((m) => `${m.trackId}:${m.n}`));
      for (const m of moves) {
        const t = tracks.find((k) => k.id === m.trackId); const tk = t && t.takes.find((k) => k.n === m.n);
        if (!tk) continue;
        const others = t.takes.filter((k) => k.n !== m.n && !moving.has(`${t.id}:${k.n}`)).map((k) => ({ x: k.x, w: clipWidth(k) }));
        tk.x = Math.max(0, Math.round(resolveNoOverlap(others, snapPx(m.x, free), clipWidth(tk))));
      }
      renderTrack();
    },
    onDeleteClip: (trackId, n) => {
      const t = tracks.find((k) => k.id === trackId);
      if (t) { pushUndo(); t.takes = t.takes.filter((k) => k.n !== n); renderTrack(); updateTransport(); }
    },
    onDeleteClips: (items) => {
      if (!items || !items.length) return;
      pushUndo();
      for (const it of items) { const t = tracks.find((k) => k.id === it.trackId); if (t) t.takes = t.takes.filter((k) => k.n !== it.n); }
      renderTrack(); updateTransport();
    },
  });
}

// Restore a persisted chain (array of {type, params}) into the model.
function loadStoredChain(data) {
  const { rest, reverb } = extractReverb(data);
  ampReverb = chainStore.loadReverb() || reverb || { size: 0.4, mix: 0 };
  const valid = rest.filter((e) => registry[e.type]); // drop unknown types defensively
  const r = chainState.fromPreset(valid, nextId);
  currentChain = r.chain; nextId = r.nextId;
  currentNormDb = null; // persisted chains don't carry normDb; neural falls back to unity
  rebuildGraph();
}

// Re-measure loudness normalization whenever the chain STRUCTURE changes
// (debounced). Param-only edits keep the signature, so they don't re-measure.
function scheduleNormalize() {
  if (!normGain) return;
  // Neural presets: skip the offline render entirely — their AudioWorklet wasm +
  // .nam model can't be loaded/awaited in an OfflineAudioContext (design §7).
  // Apply the preset's fixed, pre-measured normDb directly (0 dB / unity if the
  // chain arrived without one, e.g. restored via a track patch).
  if (isNeuralChain(currentChain)) {
    normGain.gain.value = 10 ** ((currentNormDb ?? 0) / 20);
    normSig = null;          // force a fresh measure when a normal preset loads next
    clearTimeout(normTimer);
    return;
  }
  // Reverb wet mix affects output loudness, so fold it into the signature.
  const sig = chainState.signature(currentChain) + `|rv${ampReverb.size},${ampReverb.mix}`;
  if (sig === normSig) return;
  normSig = sig;
  clearTimeout(normTimer);
  normTimer = setTimeout(async () => {
    try {
      const g = await measureLoudnessGain(chainState.toEngineChain(currentChain), { sampleRate: ctx ? ctx.sampleRate : 48000, reverb: ampReverb });
      if (normGain && chainState.signature(currentChain) === sig) normGain.gain.value = g;
    } catch (e) { console.warn('loudness normalize failed:', e); }
  }, 150);
}

function showStats() {
  const fmt = v => (v && v > 0) ? (v * 1000).toFixed(1) + ' ms' : 'not reported';
  $('base').textContent = fmt(ctx.baseLatency);
  const outLat = ctx.outputLatency;
  $('out').textContent = fmt(outLat);
  if (outLat && outLat > 0) {
    $('total').textContent = ((ctx.baseLatency + outLat) * 1000).toFixed(1) + ' ms';
  } else {
    $('total').textContent = 'unreliable';
  }
  $('verdict').textContent = 'Playing — judge the tone by ear';
}

function startMeter() {
  const timeBuf = new Uint8Array(analyser.fftSize);
  pitchBuf = new Float32Array(analyser.fftSize);
  let lastPitch = 0;
  function loop() {
    rafId = requestAnimationFrame(loop);
    // input meter (time-domain bytes) — cheap, runs every frame
    analyser.getByteTimeDomainData(timeBuf);
    let peak = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = Math.abs(timeBuf[i] - 128);
      if (v > peak) peak = v;
    }
    { const m = $('meter'); if (m) m.style.width = Math.min(100, peak / 128 * 100 * 1.5) + '%'; }
    // Note detection (McLeod Pitch Method) is O(n·maxLag) and allocates — far too
    // heavy to run at 60 fps; it can starve the audio render thread and cause
    // playback dropouts. Throttle to ~13 Hz, which is plenty for a note readout.
    const now = performance.now();
    if (now - lastPitch >= 75) {
      lastPitch = now;
      analyser.getFloatTimeDomainData(pitchBuf);
      const res = detectPitchMPM(pitchBuf, ctx.sampleRate);
      const circle = $('note-circle');
      if (circle) {
        if (res && res.freq > 0 && res.clarity > 0.9) {
          lastNoteMs = now;
          circle.textContent = noteLabel(freqToNote(res.freq));
          circle.classList.add('active');
        } else if (now - lastNoteMs > 1200) {
          circle.classList.remove('active'); // dim once the note stops ringing
        }
      }
    }
  }
  loop();
}

// ---- Calibration ----

function applyActiveCalibration() {
  if (!calibrationEq) return; // not started yet — nothing to apply to
  const p = profiles.getActive();
  calibrationEq.apply(p ? computeCorrection(p.fingerprint, p.strength) : []);
}

function renderCalibControls() {
  const active = profiles.getActive();
  renderCalibrationControls($('calibration'), {
    profiles: profiles.listProfiles(),
    activeName: active ? active.name : null,
    strength: active ? active.strength : 0.65,
  }, {
    onSelect: (name) => { profiles.setActive(name); renderCalibControls(); applyActiveCalibration(); },
    onStrength: (s) => { const a = profiles.getActive(); if (a) profiles.setStrength(a.name, s); applyActiveCalibration(); },
  });
  renderToneCard();
}

function renderToneCard() {
  const el = $('tone-card');
  const p = profiles.getActive();
  if (!p || !p.fingerprint) {
    el.innerHTML = '<p class="sub">Calibrate a guitar to see its tone card.</p>';
    return;
  }
  const stats = fingerprintToStats(p.fingerprint);
  renderProfileCard(el, { name: p.name, stats, archetype: archetype(stats) });
}

const CALIB_TARGET_MS = 12000; // ~12s of actual playing, measured in wall-clock time

function startCalibration() {
  $('calib-wizard').style.display = 'block';
  $('calib-save').disabled = true;
  $('calib-coverage').style.width = '0%';
  // Countdown so the player has time to grab the guitar before capture begins.
  let n = 3;
  $('calib-instr').textContent = `Get ready… ${n}`;
  const tick = () => {
    n--;
    if (n > 0) {
      $('calib-instr').textContent = `Get ready… ${n}`;
      calibCountdown = setTimeout(tick, 1000);
    } else {
      $('calib-instr').textContent = 'Play across the whole neck — low to high! (analyzing your dry guitar; the preset is ignored)';
      beginCapture();
    }
  };
  calibCountdown = setTimeout(tick, 1000);
}

function beginCapture() {
  calibState = createAccumulator();
  const mags = new Uint8Array(analyser.frequencyBinCount);
  const startMs = performance.now();
  const loop = () => {
    analyser.getByteFrequencyData(mags);
    const lin = Float32Array.from(mags, (v) => v / 255);
    let peak = 0; for (let i = 0; i < lin.length; i++) if (lin[i] > peak) peak = lin[i];
    accumulate(calibState, bandPowersFromMagnitudes(lin, ctx.sampleRate), peak);
    // Duration is measured in real time (not animation frames), so it behaves the
    // same on 60 Hz and 120 Hz (ProMotion) displays.
    const c = coverage(calibState, 1); // use bandFraction + leveled; override duration below
    const durationFraction = Math.min(1, (performance.now() - startMs) / CALIB_TARGET_MS);
    const cov = c.leveled ? Math.min(c.bandFraction, durationFraction) : 0;
    $('calib-coverage').style.width = (cov * 100) + '%';
    $('calib-save').disabled = cov < 0.9;
    calibRAF = requestAnimationFrame(loop);
  };
  loop();
}

function stopCalibration() {
  if (calibCountdown) { clearTimeout(calibCountdown); calibCountdown = null; }
  if (calibRAF) { cancelAnimationFrame(calibRAF); calibRAF = null; }
  $('calib-wizard').style.display = 'none';
}

function saveCalibration() {
  const name = prompt('Name this guitar (e.g. Strat):');
  if (!name) return;
  const a = profiles.getActive();
  const strength = a ? a.strength : 0.65;
  profiles.saveProfile(name, fingerprint(calibState), strength);
  stopCalibration();
  applyActiveCalibration();
  renderCalibControls();
}

async function start() {
  $('error').textContent = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: $('input').value ? { exact: $('input').value } : undefined,
        channelCount: 2,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 },
      video: false,
    });
    ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();

    // Preload AudioWorklet processors (pitch shift, looper) before any chain is
    // built, so their nodes can be constructed synchronously in buildChain.
    try { await loadWorklets(ctx); } catch (e) { console.warn('worklet load failed:', e); }

    $('sr').textContent = ctx.sampleRate + ' Hz';

    const outId = $('output').value;
    if (outId && outId !== 'default' && hasSetSinkId) { try { await ctx.setSinkId(outId); } catch {} }
    source = ctx.createMediaStreamSource(stream);

    // Analyser tap (read-only; not in the effects path). Used by the input meter
    // (time-domain), calibration capture (frequency-domain) and the tuner
    // (getLiveAnalyser). Wired below off the SELECTED splitter output — the same
    // channel that feeds calibrationEq — so it follows the chosen hardware input
    // instead of a down-mix of both channels.
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    gainOut = ctx.createGain();
    gainOut.gain.value = parseFloat($('gain').value);
    gainOut.connect(ctx.destination);

    // Per-preset loudness normalization sits before the user Vol control:
    // engine.output -> normGain -> gainOut -> destination.
    normGain = ctx.createGain();
    normGain.gain.value = 1;
    normGain.connect(gainOut);

    // Amp reverb stage sits at the end of the effect path (post-pedalboard):
    // engine.output -> reverbStage -> normGain. Created once; params live-update.
    reverbStage = reverbFx.create(ctx, ampReverb);
    reverbStage.output.connect(normGain);

    // Calibration EQ sits between source and the artist chain. A ChannelSplitter
    // in front of it lets the user pick which hardware input channel (1 or 2)
    // feeds the chain — e.g. a 2-in interface with the guitar on input 2. The
    // analyser tap is routed off the same splitter output (see routeInputChannel
    // below) so the meter, calibration capture and tuner track the selection too.
    calibrationEq = createCalibrationEq(ctx);
    inputSplitter = ctx.createChannelSplitter(2);
    source.connect(inputSplitter);
    routeInputChannel(inputChannel);
    applyActiveCalibration();

    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    // The chain may already be populated (edited before Start). If so, just wire
    // the existing model to audio; otherwise fall back to the default preset.
    if (currentChain.length === 0) loadPreset(defaultPreset);
    else rebuildGraph();

    renderCalibControls();
    startMeter();
    showStats();
    setTimeout(showStats, 600);

    setPower(true);
    { const r = $('tp-record'); if (r) { r.disabled = false; r.title = 'Record'; } }
    updateTransport(); // enable skip-to-start now that we're powered
    listDevices();
    if (new URLSearchParams(location.search).has('e2e')) installE2EBridge();
  } catch (e) {
    $('error').textContent = 'Could not start: ' + e.message;
    console.error(e);
  }
}

// ── E2E test bridge (headless Playwright only; installed when the URL has ?e2e=1) ──
// The app is mic-driven and keeps ctx/calibrationEq/normGain as module-locals, so a
// headless test can neither inject a deterministic signal nor read processed output.
// This closure exposes exactly enough of the LIVE graph to do both: a continuous
// sawtooth into the chain input (calibrationEq.input) and an RMS/HF tap on the wet
// bus (normGain). Never installed in normal use. See tests/neural-e2e.mjs.
function installE2EBridge() {
  let osc = null, toneGain = null, outTap = null;
  const proCat = () => GB_CATEGORIES.find((c) => c.id === 'pro');
  const neuralUnit = () => currentChain.find((u) => u.type === 'neuralamp');
  const ensureTap = () => {
    if (!outTap) { outTap = ctx.createAnalyser(); outTap.fftSize = 2048; normGain.connect(outTap); }
    return outTap;
  };
  const api = {
    booted: () => !!ctx && ctx.state === 'running',
    sampleRate: () => ctx.sampleRate,
    clock: () => ({ ctxTime: ctx.currentTime, wall: performance.now() }),
    proPresetNames: () => (proCat() ? proCat().presets.map((p) => p.name) : []),
    chainTypes: () => currentChain.map((u) => u.type),
    loadPresetByName: (name) => {
      const p = PRESETS.find((x) => x.name === name);
      if (!p) throw new Error('no preset named ' + name);
      loadPreset(p);
      return true;
    },
    feedTone: (freq = 110, amp = 0.25) => {
      api.stopTone();
      osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
      toneGain = ctx.createGain(); toneGain.gain.value = amp;
      osc.connect(toneGain).connect(calibrationEq.input);
      osc.start();
    },
    stopTone: () => {
      if (osc) { try { osc.stop(); } catch {} osc.disconnect(); osc = null; }
      if (toneGain) { toneGain.disconnect(); toneGain = null; }
    },
    getOutputMetrics: () => {
      const a = ensureTap();
      const t = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(t);
      let sum = 0, finite = true;
      for (let i = 0; i < t.length; i++) { const v = t[i]; if (!Number.isFinite(v)) finite = false; sum += v * v; }
      const f = new Float32Array(a.frequencyBinCount);
      a.getFloatFrequencyData(f); // magnitude in dB
      const binHz = (ctx.sampleRate / 2) / f.length;
      let lo = 0, hi = 0;
      for (let i = 0; i < f.length; i++) { const p = Math.pow(10, f[i] / 10); if (i * binHz >= 2000) hi += p; else lo += p; }
      return { rms: Math.sqrt(sum / t.length), finite, hf: hi / (lo + hi + 1e-12) };
    },
    addPedalBefore: (type) => { const amp = neuralUnit(); addEffect(type, amp ? amp.instanceId : null); },
    addPedalAfter: (type) => {
      const amp = neuralUnit();
      const i = currentChain.findIndex((u) => u.instanceId === amp.instanceId);
      const after = currentChain[i + 1];
      addEffect(type, after ? after.instanceId : null);
    },
  };
  window.__neuralE2E = api;
}

function stop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (recorder.isRecording()) recorder.stop();
  if (player.isPlaying()) { player.stop(); reflectPlay(); }
  clearLiveClip();
  { const r = $('tp-record'); if (r) { r.disabled = true; r.classList.remove('recording'); r.title = 'Record — available with recording'; } }
  stopCalibration();
  $('meter').style.width = '0%';
  { const c = $('note-circle'); if (c) { c.textContent = '—'; c.classList.remove('active'); } }
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = normGain = analyser = calibrationEq = reverbStage = inputSplitter = null;
  setPower(false);
  updateTransport(); // disable skip-to-start when powered off
  prevBars = null;
  { const fl = $('freq-label'); if (fl) { fl.textContent = '— Hz'; fl.style.color = ''; } }
}

// Route the splitter's selected channel to both live-graph consumers:
// calibrationEq (the processed/recorded path) and analyser (input meter,
// calibration capture, tuner). connectInputChannel()'s disconnect() clears ALL
// of the splitter's outputs, so calling it twice in a row would undo the first
// destination's wiring — reuse it for calibrationEq, then fan the analyser out
// manually on the same splitter output. No-op before Start, when the splitter
// (and its consumers) aren't up yet.
function routeInputChannel(ch) {
  if (!inputSplitter || !calibrationEq || !analyser) return;
  connectInputChannel(inputSplitter, ch, calibrationEq.input);
  inputSplitter.connect(analyser, ch);
}

// Re-route the live input to a different hardware channel (1 or 2). Persists the
// selection so it survives power cycles; no-op on the graph until Start wires it.
function setInputChannel(ch) {
  inputChannel = Math.min(1, Math.max(0, ch | 0));
  routeInputChannel(inputChannel);
}

async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [kind, sel] of [['audioinput', $('input')], ['audiooutput', $('output')]]) {
    sel.innerHTML = '';
    devices.filter(d => d.kind === kind).forEach((d, i) => {
      const o = new Option(d.label || `${kind} ${i + 1}`, d.deviceId);
      if (/focusrite|scarlett|usb/i.test(d.label)) o.selected = true;
      sel.add(o);
    });
    if (!sel.options.length) sel.add(new Option('System default', 'default'));
  }
}

// Single power toggle: off → start the engine, on → stop it. While off, the
// workspace (track lane / amp / pedalboard) is dimmed until powered on.
function setPower(on) {
  const b = $('power');
  if (b) { b.classList.toggle('on', on); b.classList.toggle('off', !on); b.title = on ? 'Power off the amp engine' : 'Power on the amp engine'; }
  document.body.classList.toggle('powered-off', !on);
}
$('power').addEventListener('click', () => { if (ctx) stop(); else start(); });
setPower(false);
$('calib-save').addEventListener('click', saveCalibration);
$('calib-cancel').addEventListener('click', stopCalibration);
$('calib-start').addEventListener('click', startCalibration);
$('input-channel').addEventListener('change', (e) => setInputChannel(+e.target.value));

// Settings slide-in panel
function setSettings(open) {
  $('settings-panel').classList.toggle('open', open);
  const bd = $('settings-backdrop');
  if (open) { bd.hidden = false; requestAnimationFrame(() => bd.classList.add('open')); }
  else { bd.classList.remove('open'); setTimeout(() => { bd.hidden = true; }, 220); }
}
$('settings-toggle').addEventListener('click', () => setSettings(!$('settings-panel').classList.contains('open')));
$('settings-close').addEventListener('click', () => setSettings(false));
$('settings-backdrop').addEventListener('click', () => setSettings(false));

// Presets slide-in drawer (narrow screens) — mirrors the settings drawer.
function setPresets(open) {
  document.body.classList.toggle('presets-open', open);
  const bd = $('presets-backdrop');
  if (open) { bd.hidden = false; requestAnimationFrame(() => bd.classList.add('open')); }
  else { bd.classList.remove('open'); setTimeout(() => { bd.hidden = true; }, 220); }
}
// Wide screens: the browser is a persistent sidebar, so the toolbar button
// collapses/expands it (persisted). Narrow screens: it's a drawer, so the button
// opens/closes the drawer.
function setPresetsHidden(hidden) {
  document.body.classList.toggle('presets-hidden', hidden);
  chainStore.savePresetsHidden(hidden);
}
const isNarrow = () => window.matchMedia('(max-width: 1040px)').matches;
$('presets-toggle').addEventListener('click', () => {
  if (isNarrow()) setPresets(!document.body.classList.contains('presets-open'));
  else setPresetsHidden(!document.body.classList.contains('presets-hidden'));
});
$('presets-close').addEventListener('click', () => setPresets(false));
$('presets-backdrop').addEventListener('click', () => setPresets(false));
if (chainStore.loadPresetsHidden()) document.body.classList.add('presets-hidden');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setSettings(false); setPresets(false); } });
$('diag').textContent = `${isSafari ? 'Safari' : 'Chrome'} · setSinkId: ${hasSetSinkId ? 'yes' : 'no'}`;

// Read the theme accent once for canvas drawing (the spectrum).
accentRGB = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '240,180,41';

navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});

// Initialize the editable chain on load (works before Start; audio wires up on
// Start). Restore a persisted chain if present, else load the default preset.
(function initChain() {
  const stored = chainStore.load();
  if (stored && Array.isArray(stored) && stored.length) loadStoredChain(stored);
  else loadPreset(PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0]);
  renderBrowser();
  // Start with one armed track named after the active preset; it owns the
  // initial chain so per-track patch memory works from the first switch.
  const t0 = newTrack(activePresetName); t0.armed = true;
  tracks = [t0]; armedId = t0.id;
  saveTrackPatch(t0);
  renderTrack();
})();

// Toolbar transport cluster: inert transport (ground for recording) + working
// metronome and tuner. The tuner taps the live engine analyser when running.
const transport = mountTransport($('transport-cluster'), {
  getLiveAnalyser: () => analyser,
  onGain: (v) => { if (gainOut) gainOut.gain.value = v; },
});

// Record: capture the live processed output into a take, append it as a clip.
{
  const recBtn = $('tp-record');
  if (recBtn) recBtn.addEventListener('click', () => {
    if (!ctx) return; // only while live
    if (recBtn.classList.contains('counting')) return; // ignore re-click mid count-in
    const track = armedTrack();
    if (!track) return; // need an armed track to record into
    if (recorder.isRecording()) {
      clearLiveClip();
      const t = recorder.stop();
      transport.endSession();
      recBtn.classList.remove('recording');
      if (t && t.samples.length) {
        pushUndo();
        const newStart = recStartX / PX_PER_SEC;
        punchOver(track, newStart, newStart + (t.duration || 0)); // overwrite overlapped audio
        track.takes.push({ ...t, n: ++takeSeq, name: track.name, x: recStartX, offset: 0, len: t.duration });
        renderTrack();
        updateTransport();
      }
    } else {
      if (player.isPlaying()) { player.stop(); reflectPlay(); }
      // Actually begin capture + grow the live clip. Deferred past the count-in.
      const begin = () => {
        recBtn.classList.remove('counting');
        if (!ctx || recorder.isRecording()) return;
        recorder.start();
        recBtn.classList.add('recording');
        // Grow a purple clip in real time in the armed track's strip.
        const area = $('track-lane') && $('track-lane').querySelector(`.track-strip[data-track-id="${track.id}"]`);
        if (area) {
          // Recording starts AT the playhead (where the user parked it), not at
          // the end of the track. The clip + the stored take share this anchor.
          const startT = ctx.currentTime, startSec = Math.max(0, playheadSec);
          const x = Math.round(startSec * PX_PER_SEC); recStartX = x;
          liveClip = document.createElement('div');
          liveClip.className = 'track-clip recording-clip';
          liveClip.style.cssText = `left:${x}px;top:6px;height:80px;width:0px`;
          const lbl = document.createElement('div'); lbl.className = 'clip-label'; lbl.textContent = `${track.name || 'Take'} #${takeSeq + 1}`;
          const canvas = document.createElement('canvas'); canvas.className = 'clip-wave'; canvas.height = 80;
          liveClip.append(lbl, canvas);
          area.appendChild(liveClip);
          let lastDraw = 0;
          const grow = () => {
            if (!liveClip) return;
            const elapsed = ctx.currentTime - startT;
            const w = Math.max(0, elapsed * PX_PER_SEC);
            liveClip.style.width = `${w}px`;
            setPlayhead(startSec + elapsed); // playhead rides the leading edge while recording
            const now = performance.now();
            if (now - lastDraw > 50) { // redraw the live waveform ~20fps
              lastDraw = now;
              canvas.width = Math.max(1, Math.floor(w));
              drawWaveform(canvas, recorder.samplesSoFar(), { color: '#d8daf8' });
            }
            liveRAF = requestAnimationFrame(grow);
          };
          grow();
        }
      };
      // Count-in and/or metronome → one continuous beat grid; recording starts
      // on the downbeat. No count-in and no metronome → begin immediately.
      if (transport.needsSession()) {
        // Pulse the record button while counting in (count-in toggle or practice).
        if (transport.isCountIn() || transport.isMetroFree()) recBtn.classList.add('counting');
        transport.recordSession(begin);
      } else {
        begin();
      }
    }
  });

  // Play / Stop playback of recorded takes; the playhead sweeps the timeline.
  const playBtn = $('tp-play');
  if (playBtn) playBtn.addEventListener('click', () => {
    if (player.isPlaying()) { player.stop(); reflectPlay(); return; }
    if (!allTakes().length) return;
    player.play(buildGroups(), playheadSec, setPlayhead, () => { reflectPlay(); setPlayhead(0); });
    reflectPlay();
  });

  // Skip to start: stop playback and park the playhead at bar 1.
  const skipBtn = $('tp-start');
  if (skipBtn) skipBtn.addEventListener('click', () => {
    player.stop(); reflectPlay(); setPlayhead(0);
  });

  // Seek + scrub: click an empty part of the timeline to move the playhead, or
  // press-drag the ruler / playhead grip to scrub. Snaps to grid when enabled.
  // Clicks on a clip are ignored (clips handle their own drag).
  const lane = $('track-lane');
  function seekToClientX(clientX, free) {
    const tl = lane.querySelector('.track-timeline');
    if (!tl) return;
    const x = e_x(clientX, tl);
    player.stop(); reflectPlay();
    setPlayhead(snapPx(Math.max(0, x), free) / PX_PER_SEC);
  }
  function e_x(clientX, tl) { return clientX - tl.getBoundingClientRect().left + tl.scrollLeft; }
  if (lane) {
    lane.addEventListener('click', (e) => {
      if (e.target.closest('.track-clip')) return;
      const tl = lane.querySelector('.track-timeline');
      if (!tl || !tl.contains(e.target)) return;
      seekToClientX(e.clientX, e.ctrlKey);
    });
    // Right-click: clip → Copy/Paste/Split/Delete; empty strip → Paste.
    lane.addEventListener('contextmenu', (e) => {
      const clip = e.target.closest('.track-clip');
      if (clip && clip.dataset.takeId) {
        e.preventDefault();
        const tid = Number(clip.dataset.trackId), n = Number(clip.dataset.takeId);
        // If the right-clicked clip is part of a multi-selection, Delete removes
        // the whole selection; otherwise just this clip.
        const sel = getSelectedClips();
        const inSel = sel.some((s) => s.trackId === tid && s.n === n);
        const targets = inSel && sel.length > 1 ? sel : [{ trackId: tid, n }];
        openCtxMenu(e.clientX, e.clientY, [
          ctxItem('Copy', () => copyClip(tid, n)),
          ctxItem('Paste at playhead', () => pasteClip(tid), !clipboard),
          ctxItem('Split at playhead', () => splitClip(tid, n)),
          ctxItem(targets.length > 1 ? `Delete ${targets.length} clips` : 'Delete', () => deleteClips(targets)),
        ]);
        return;
      }
      const strip = e.target.closest('.track-strip');
      if (strip && strip.dataset.trackId) {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [ctxItem('Paste at playhead', () => pasteClip(Number(strip.dataset.trackId)), !clipboard)]);
      }
    });
    lane.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.track-clip')) return;
      if (!e.target.closest('.track-ruler') && !e.target.closest('.playhead-grip')) return;
      seekToClientX(e.clientX, e.ctrlKey);
      const move = (ev) => seekToClientX(ev.clientX, ev.ctrlKey);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      e.preventDefault();
    });
  }

  updateTransport();
}
