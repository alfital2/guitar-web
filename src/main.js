// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset, GB_CATEGORIES } from './presets.js';
import { renderPresetBrowser } from './preset-browser.js';
import { renderPedalboard, setPedalBypassed } from './chain-ui/pedalboard.js';
import { renderAmp } from './chain-ui/amp.js';
import { applyRigDock } from './chain-ui/rig-bar.js';
import { createAutoFold } from './chain-ui/auto-fold.js';
import { playPowerOnRitual } from './chain-ui/power-on.js';
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
import { createLoudnessController } from './loudness.js';
import { mountTransport } from './transport-ui.js';
import { renderTrackLane, PX_PER_SEC, beatPx, ensureRulerBars, getSelectedClips, clearClipSelection, setClipSelection } from './track-lane.js';
import { punchTakes, recordHeadTrimSec } from './take-ops.js';
import { createRecorder } from './recorder.js';
import { createPlayer } from './player.js';
import { drawWaveform } from './waveform.js';
import { cloneTake, splitTakeAt, resolveNoOverlap, clampRepeat, planPaste } from './clip-ops.js';
import * as chainState from './chain-state.js';
import * as chainStore from './chain-store.js';
import { loadWorklets } from './effects/worklets/index.js';
import * as reverbFx from './effects/reverb.js';
import { connectInputChannel } from './audio/input-channel.js';
import { maybeShowSafariNotice } from './browser-notice.js';
import { assignFret, quantizeToGrid, tabTimeForTransport } from './tab/transcribe.js';
import { encodeWav } from './wav.js';
import { transcribeTake } from './tab/offline-transcribe.js';
import { mountTabLane } from './tab/tab-lane.js';
import { createTabMidiPlayer } from './tab/tab-midi-player.js';
import { initJamUI } from './jam-ui.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut, normGain, analyser, rafId;
// Reverb lives in the amp now (post-pedalboard, always on), not as a pedal.
const REVERB_ID = '__amp_reverb__';
let ampReverb = { size: 0.4, mix: 0 }; // amp reverb params (size, wet mix)
let ampCollapsed = chainStore.loadAmpCollapsed(); // amp folded to value strip
let boardCollapsed = chainStore.loadBoardCollapsed(); // pedalboard folded to mini strip
let reverbStage = null;                // audio node: engine.output -> reverbStage -> normGain
let calibrationEq, calibRAF, calibState, calibCountdown;
let inputSplitter = null;   // ChannelSplitterNode after source; picks a hardware input channel
let inputChannel = chainStore.loadInputChannel(); // 0 = input 1, 1 = input 2 — REMEMBERED across sessions (interface users live on ch 2)
let chMeters = null;        // [AnalyserNode, AnalyserNode] tapping splitter outs 0/1 for the settings CH1/CH2 meters
let vuLevel = 0;            // smoothed 0..1 output level driving the amp-head VU needle
let pitchBuf, lastNoteMs = 0;
let prevBars = null;
let accentRGB = '240,180,41'; // current theme accent for canvas drawing

let tracks = [];         // [{ id, name, armed, takes: [] }]
let nextTrackId = 1;     // track id source
let armedId = null;      // the record-armed track
let takeSeq = 0;         // running take number for clip labels (global)
let liveRAF = null, liveClip = null; // in-progress (growing) recording clip
let recStartX = 0;                   // px x-position where the current take began
let recBackingT0 = null;             // ctx time the overdub backing was scheduled at
let recCapStart = 0;                 // ctx time capture began (same clock as recBackingT0)
// Tap normGain (post loudness-normalization, pre Vol) so the take matches what
// you hear and is independent of the master Vol slider.
const recorder = createRecorder({ getSource: () => normGain, getContext: () => ctx });
const player = createPlayer({ getContext: () => ctx }); // one clock with the live graph + recorder
const tabMidi = createTabMidiPlayer({ getContext: () => ctx }); // plays the TAB itself as MIDI notes

// ── Transport auto-fold ──
// While recording/playing the tracks deserve the vertical space: fold the amp
// + pedalboard into the rig bar on transport start, and restore each panel to
// its PRE-transport state on stop (a panel the user had collapsed manually
// stays collapsed). The fold goes through the panels' silent set-collapsed
// events (same code path as the UI controls, incl. the amp strip value sync)
// so nothing re-renders and the audio graph is untouched; persistence only
// happens on restore, so storage always matches the user's real preference.
const autoFold = createAutoFold({
  getState: () => ({ amp: ampCollapsed, board: boardCollapsed }),
  setState: ({ amp, board }, restoring) => {
    ampCollapsed = amp; boardCollapsed = board;
    if (restoring) { chainStore.saveAmpCollapsed(amp); chainStore.saveBoardCollapsed(board); }
    $('amp')?.querySelector('.amp-wrap')?.dispatchEvent(new CustomEvent('amp-set-collapsed', { detail: { collapsed: amp } }));
    $('chain')?.querySelector('.board-wrap')?.dispatchEvent(new CustomEvent('board-set-collapsed', { detail: { collapsed: board } }));
    applyRigDock(ampCollapsed, boardCollapsed);
  },
});
// Restore the panels only when the transport is fully idle — a seek/skip stops
// PLAYBACK, but must not unfold the rig mid-recording.
function restoreFoldIfIdle() {
  if (!recorder.isRecording() && !player.isPlaying()) autoFold.restore();
}

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

// ── Clip clipboard + ops (⌘/Ctrl shortcuts + right-click menu) ──
// Internal only — the OS clipboard is not involved. Entries remember their
// source track and their x relative to the leftmost copied clip, so paste can
// keep the arrangement. Samples stay shared (immutable app-wide; clip-ops.js).
let clipboard = null; // { clips: [{ trackId, dx, take }] } — leftmost dx = 0
function copyClips(items) {
  const found = [];
  for (const it of items) {
    const t = tracks.find((k) => k.id === it.trackId);
    const tk = t && t.takes.find((k) => k.n === it.n);
    if (tk) found.push({ trackId: t.id, take: cloneTake(tk) });
  }
  if (!found.length) return false;
  const minX = Math.min(...found.map((f) => f.take.x || 0));
  clipboard = { clips: found.map((f) => ({ trackId: f.trackId, dx: (f.take.x || 0) - minX, take: f.take })) };
  return true;
}
// Paste at the playhead. A single-track clipboard goes to `explicitTrackId`
// (right-clicked strip), else the armed track, else its source track; a
// multi-track clipboard pastes each clip back into its ORIGINATING track
// (GarageBand), keeping the stored arrangement with the leftmost clip landing
// at the (snapped) playhead. Fresh take numbers; one undo step; the pasted
// clips become the new selection.
function pasteClipboard(explicitTrackId) {
  if (!clipboard || !clipboard.clips.length) return;
  let clips = clipboard.clips;
  const srcIds = new Set(clips.map((c) => c.trackId));
  if (srcIds.size === 1) {
    const target = (explicitTrackId != null && tracks.find((t) => t.id === explicitTrackId))
      || armedTrack() || tracks.find((t) => t.id === clips[0].trackId);
    if (!target) return;
    clips = clips.map((c) => ({ ...c, trackId: target.id }));
  } else {
    clips = clips.filter((c) => tracks.some((t) => t.id === c.trackId)); // a source track may be gone
    if (!clips.length) return;
    const minDx = Math.min(...clips.map((c) => c.dx)); // re-anchor: leftmost survivor lands at the playhead
    if (minDx) clips = clips.map((c) => ({ ...c, dx: c.dx - minDx }));
  }
  const occ = new Map(tracks.map((t) => [t.id, t.takes.map((k) => ({ x: k.x, w: clipWidth(k) }))]));
  const placed = planPaste(clips, snapPx(playheadSec * PX_PER_SEC), occ, clipWidth);
  pushUndo();
  const pasted = [];
  for (const p of placed) {
    const t = tracks.find((k) => k.id === p.trackId);
    const nu = { ...cloneTake(p.take), n: ++takeSeq, x: p.x };
    t.takes.push(nu);
    pasted.push({ trackId: t.id, n: nu.n });
  }
  setClipSelection(pasted); // renderTrack re-applies the highlight
  renderTrack(); updateTransport();
}
// Duplicate each clip onto ITS OWN track, immediately after the original's
// span end (⌘/Ctrl+D). One undo step; the copies become the new selection.
function duplicateClips(items) {
  const clips = [];
  for (const it of items) {
    const t = tracks.find((k) => k.id === it.trackId);
    const tk = t && t.takes.find((k) => k.n === it.n);
    if (tk) clips.push({ trackId: t.id, dx: (tk.x || 0) + clipWidth(tk), take: cloneTake(tk) });
  }
  if (!clips.length) return;
  const occ = new Map(tracks.map((t) => [t.id, t.takes.map((k) => ({ x: k.x, w: clipWidth(k) }))]));
  const placed = planPaste(clips, 0, occ, clipWidth); // dx alone = right after each original
  pushUndo();
  const dupes = [];
  for (const p of placed) {
    const t = tracks.find((k) => k.id === p.trackId);
    const nu = { ...cloneTake(p.take), n: ++takeSeq, x: p.x };
    t.takes.push(nu);
    dupes.push({ trackId: t.id, n: nu.n });
  }
  setClipSelection(dupes);
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

// ── Clipboard shortcuts (Mac ⌘ / Windows Ctrl): C copy, X cut, V paste at
// playhead, D duplicate in place, A select all clips. Shortcuts fall through
// to the browser whenever they'd be a no-op here (nothing selected / empty
// clipboard / no clips at all) and inside text fields.
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key !== 'c' && key !== 'x' && key !== 'v' && key !== 'd' && key !== 'a') return;
  if (/^(INPUT|TEXTAREA)$/.test((e.target.tagName || '')) || e.target.isContentEditable) return;
  if (key === 'a') {
    const all = tracks.flatMap((t) => t.takes.map((k) => ({ trackId: t.id, n: k.n })));
    if (!all.length) return;
    e.preventDefault();
    setClipSelection(all, $('track-lane')); // highlight in place, no re-render
    return;
  }
  if (key === 'v') {
    if (!clipboard) return;
    e.preventDefault();
    pasteClipboard();
    return;
  }
  const sel = getSelectedClips();
  if (!sel.length) return;
  e.preventDefault();
  if (key === 'c') copyClips(sel);
  else if (key === 'x') { if (copyClips(sel)) deleteClips(sel); } // cut = copy + delete (one undo step)
  else duplicateClips(sel);
});

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
  if (ph) ph.style.left = `${playheadSec * PX_PER_SEC * zoomLevel}px`;
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
// Loudness normalization: measuring lives in normalize.js, the WHEN/HOW
// controller in loudness.js. Reverb wet mix affects loudness → in the signature.
const loudness = createLoudnessController({
  getCtx: () => ctx,
  getNormGain: () => normGain,
  getEngineChain: () => chainState.toEngineChain(currentChain),
  getSignature: () => chainState.signature(currentChain) + `|rv${ampReverb.size},${ampReverb.mix}`,
  getReverb: () => ampReverb,
});
const scheduleNormalize = () => loudness.schedule();

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

// Liquid-glass surfaces use `backdrop-filter: url(#svg-filter)` for refraction,
// which Safari doesn't support — enable only off Safari (gated by html.liquid).
if (!isSafari) document.documentElement.classList.add('liquid');
// Safari compositor relief: drops always-on backdrop-filters + animated-blend
// composites that WebKit re-renders every frame (see index.html html.safari).
if (isSafari) document.documentElement.classList.add('safari');
// One-time honest heads-up that Safari's live-input path is higher-latency than
// Chrome's (a WebKit limitation below the web layer — can't be fixed here).
maybeShowSafariNotice(isSafari);
// Returning users know where Power is — retire the "Start here" callout.
if (chainStore.loadHasStarted()) document.documentElement.classList.add('has-started');
if (isSafari) { const n = $('safari-latency-note'); if (n) n.hidden = false; }

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
// Rebuild only the AUDIO graph from the current chain model (no DOM work).
function rebuildAudio() {
  if (!ctx) return;
  if (engine) {
    try { calibrationEq.output.disconnect(); } catch {}
    try { engine.output.disconnect(); } catch {}
    // Stop every LFO oscillator / worklet the old chain started before it's
    // abandoned — otherwise running sources never GC and keep costing CPU
    // (worst case: an abandoned neural-amp worklet keeps running inference).
    try { engine.destroy?.(); } catch (e) { console.warn('engine destroy failed:', e); }
  }
  engine = buildChain(ctx, chainState.toEngineChain(currentChain), registry);
  if (calibrationEq) calibrationEq.output.connect(engine.input);
  // Pedalboard feeds the amp reverb stage, which feeds normGain.
  if (reverbStage) { reverbStage.apply(ampReverb); engine.output.connect(reverbStage.input); }
  else if (normGain) engine.output.connect(normGain);
}

function rebuildGraph() {
  const view = currentChain.map((u) => ({ ...u, schema: registry[u.type].schema }));
  const locked = view.filter((u) => u.locked);

  rebuildAudio();

  // The amp head also hosts the always-on reverb (rendered as a synthetic module
  // so it reuses the amp-knob UI), placed after the drive/eq/cabinet groups.
  const ampModules = [...locked, { instanceId: REVERB_ID, schema: reverbFx.schema, params: ampReverb }];
  try {
    renderAmp($('amp'), ampModules, onAmpParam, {
      collapsed: ampCollapsed,
      onCollapse: (c) => { ampCollapsed = c; chainStore.saveAmpCollapsed(c); applyRigDock(ampCollapsed, boardCollapsed); },
    });
    renderPedalboard($('chain'), view, {
      onParamChange: setParamLive,
      onAdd: addEffect,
      onRemove: removeEffect,
      onMove: moveEffect,
      onToggleBypass: toggleBypass,
      // Live params for the pedal-screen viz: read straight from the chain
      // model so knob turns show on the next viz tick (chain-state replaces
      // params objects immutably, so the viz must look them up fresh).
      getLiveParams: (id) => currentChain.find((u) => u.instanceId === id)?.params,
    }, {
      collapsed: boardCollapsed,
      onCollapse: (c) => { boardCollapsed = c; chainStore.saveBoardCollapsed(c); applyRigDock(ampCollapsed, boardCollapsed); },
    });
  } catch (e) {
    $('error').textContent = 'render: ' + e.message;
    console.error(e);
  }
  // Rig bar: both panels collapsed → their strips dock into one slim row.
  applyRigDock(ampCollapsed, boardCollapsed);

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
  // Ordinary knob turns deliberately DON'T re-normalize (a volume/drive knob is
  // supposed to change loudness). The neural `model` param is not a knob — it
  // swaps the whole captured amp, whose inherent level varies by 10+ dB — so
  // treat it like a preset change and re-measure.
  const unit = currentChain.find((u) => u.instanceId === instanceId);
  if (unit && unit.type === 'neuralamp' && key === 'model') {
    loudness.invalidate({ mute: true }); // an amp swap holds silence until its gain lands
    scheduleNormalize();
  }
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
  // One-shot entrance sheen on the pedal that was just added (see .pedal--enter).
  requestAnimationFrame(() => {
    const el = $('chain')?.querySelector(`.pedal[data-instance-id="${newId}"]`);
    if (!el) return;
    el.classList.add('pedal--enter');
    el.addEventListener('animationend', () => el.classList.remove('pedal--enter'), { once: true });
  });
}

function removeEffect(instanceId) {
  currentChain = chainState.remove(currentChain, instanceId);
  rebuildGraph();
}

function toggleBypass(instanceId) {
  currentChain = chainState.toggleBypass(currentChain, instanceId);
  const u = currentChain.find((x) => x.instanceId === instanceId);
  // The signal path changed, so rebuild the AUDIO graph — but do NOT re-render
  // the board. A full render recreates each pedal's screen canvas, which flashes
  // a blank frame (the flicker). Instead flip just this pedal's bypass state in
  // place (pure-CSS dim; the drawn screen persists).
  rebuildAudio();
  const label = u && registry[u.type]?.schema?.label;
  if (!u || !setPedalBypassed($('chain'), instanceId, u.bypassed, label)) { rebuildGraph(); return; }
  chainStore.save(currentChain);
  scheduleNormalize();
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
  const { rest, reverb } = chainState.extractReverb(preset.chain);
  ampReverb = reverb || { size: 0.4, mix: 0 };
  chainStore.saveReverb(ampReverb);
  const r = chainState.fromPreset(rest, nextId);
  currentChain = r.chain; nextId = r.nextId;
  activePresetName = preset.name;
  loudness.invalidate({ mute: true }); // a preset load ALWAYS re-measures (two
  // presets can share a signature yet differ hugely in level) and holds
  // silence until its gain lands
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
  loudness.invalidate({ mute: true }); // patch loads re-measure like preset loads
  rebuildGraph();
  renderBrowser();
  return true;
}

// Deep-clone a track's sound patch (chain + amp reverb + preset name). Sample
// buffers are shared (immutable); everything else is copied so the duplicate is
// fully independent.
function clonePatch(p) {
  if (!p) return null;
  return {
    chain: (p.chain || []).map((u) => ({ type: u.type, params: { ...u.params }, bypassed: !!u.bypassed })),
    reverb: p.reverb ? { ...p.reverb } : null,
    name: p.name || null,
  };
}

// Duplicate an ENTIRE track: its recorded takes (with every edit — position,
// trim window, loop repeat), its mixer state (volume/pan/mute/solo), and its
// full amp + effects patch. The copy lands directly beneath the source. The
// armed track is untouched, so the live audio graph isn't disturbed.
function duplicateTrack(trackId) {
  const src = tracks.find((t) => t.id === trackId);
  if (!src) return;
  pushUndo();
  // Make sure the armed track's patch reflects the LIVE chain before we clone
  // (a non-armed track's patch is already current from when it was left).
  saveTrackPatch(armedTrack());
  const copy = {
    id: nextTrackId++,
    name: `${src.name || 'Track'} copy`,
    armed: false,
    takes: src.takes.map((tk) => ({ ...cloneTake(tk), n: ++takeSeq })),
    volume: src.volume == null ? 0.8 : src.volume,
    pan: src.pan || 0,
    mute: !!src.mute,
    solo: !!src.solo,
    patch: clonePatch(src.patch),
  };
  const i = tracks.findIndex((t) => t.id === trackId);
  tracks.splice(i + 1, 0, copy); // insert right below the source
  renderTrack(); updateTransport(); syncMix();
}

// Remove a track (shared by the header ✕ button and the right-click menu).
function removeTrack(id) {
  pushUndo();
  const removingArmed = armedId === id;
  tracks = tracks.filter((t) => t.id !== id);
  if (removingArmed) {
    armedId = tracks.length ? tracks[tracks.length - 1].id : null;
    loadTrackPatch(armedTrack()); // restore the newly-armed track's patch
  }
  tracks.forEach((t) => { t.armed = t.id === armedId; });
  renderTrack(); updateTransport();
}

// Right-click track menu. One place to add future per-track actions (color,
// freeze, export, reorder …) — the contextmenu wiring just calls this.
function trackMenuItems(trackId) {
  return [
    ctxItem('Duplicate Track', () => duplicateTrack(trackId)),
    ctxItem('Delete Track', () => removeTrack(trackId)),
  ];
}

function renderBrowser() {
  const el = $('preset-browser');
  if (el) renderPresetBrowser(el, GB_CATEGORIES, loadPreset, activePresetName, () => setPresetsHidden(true));
}

let snapOn = true;
// Current tempo mirrored from the transport (updated via onTempoChange). A plain
// module var — NOT read off `transport`, which is a const declared later and
// would be in its temporal dead zone during the initial renderTrack().
let uiBpm = 120;
// Timeline view zoom (persisted). A pure view multiplier — take positions stay
// in base px, so zooming never moves audio (see track-lane.js).
let zoomLevel = chainStore.loadZoom();
// Snap to the BEAT grid at the current tempo (one beat = 60/bpm sec × PX_PER_SEC
// → 16px @120, 24px @80). Was a hardcoded 16px, which only matched 120 BPM.
// Hold Ctrl to bypass snapping entirely (free, sub-pixel-precise placement).
function snapPx(x, free) { if (!snapOn || free) return x; const b = beatPx(uiBpm); return Math.round(x / b) * b; }
// Visible/played SPAN of a take in seconds — the trim window (`len` once
// trimmed, else the full recorded `duration`) times its loop `repeat`
// (GarageBand loop-drag; absent/1 = no loop). `offset` is how far into the
// samples playback starts. All overlap/width math sees the full looped span.
const clipLen = (tk) => (tk.len != null ? tk.len : (tk.duration || 0)) * (tk.repeat > 1 ? tk.repeat : 1);
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
  // ENDLESS timeline: the grid grows with the content (old hardcoded 16 bars
  // meant long takes ran off the ruler). Min 16 bars, content + 8 headroom.
  const secPerBar = (60 / uiBpm) * 4;
  const contentEnd = Math.max(playheadSec,
    ...tracks.flatMap((t) => t.takes.map((tk) => (tk.x || 0) / PX_PER_SEC + clipLen(tk))), 0);
  renderTrackLane(el, {
    tracks,
    armedId,
    snap: snapOn,
    playheadSec,
    bars: Math.max(16, Math.ceil(contentEnd / secPerBar) + 8),
    bpm: uiBpm,
    zoom: zoomLevel,
    onZoom: (z, anchor) => {
      zoomLevel = z; chainStore.saveZoom(z); renderTrack();
      // Wheel/pinch zoom: keep the time under the cursor stationary.
      if (anchor) {
        const tl = $('track-lane')?.querySelector('.track-timeline');
        if (tl) tl.scrollLeft = Math.max(0, anchor.anchorSec * PX_PER_SEC * z - anchor.cursorPx);
      }
    },
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
    onRemoveTrack: (id) => removeTrack(id),
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
    // Loop a clip (GarageBand loop handle): `repeat` window repetitions, the
    // last possibly partial. Non-destructive — only the repeat field changes.
    // Clamped so the extended span never runs into the next clip on the track.
    onLoopClip: (trackId, n, repeat) => {
      const t = tracks.find((k) => k.id === trackId); const tk = t && t.takes.find((k) => k.n === n);
      if (!tk) return;
      const len = tk.len != null ? tk.len : (tk.duration || 0);
      if (!(len > 0)) return;
      pushUndo();
      tk.repeat = clampRepeat(occupiedExcept(t, n), tk.x || 0, len, repeat, PX_PER_SEC);
      renderTrack(); updateTransport();
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
  const { rest, reverb } = chainState.extractReverb(data);
  ampReverb = chainStore.loadReverb() || reverb || { size: 0.4, mix: 0 };
  const valid = rest.filter((e) => registry[e.type]); // drop unknown types defensively
  const r = chainState.fromPreset(valid, nextId);
  currentChain = r.chain; nextId = r.nextId;
  loudness.invalidate({ mute: true }); // restored chains re-measure like preset loads
  rebuildGraph();
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

// Peak of an analyser's time-domain signal, normalised to 0..1.
function analyserPeak(a, buf) {
  a.getByteTimeDomainData(buf);
  let peak = 0;
  for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128); if (v > peak) peak = v; }
  return peak / 128;
}

function startMeter() {
  const timeBuf = new Uint8Array(analyser.fftSize);
  const chBuf = new Uint8Array(chMeters ? chMeters[0].fftSize : 1024);
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

      // Amp-head VU needle: smooth the level, map to a −50°…+50° sweep. The
      // 80ms CSS transition on .amp-vu-needle supplies the ballistics.
      const lvl = Math.min(1, peak / 128 * 1.5);
      vuLevel += (lvl - vuLevel) * 0.5;
      const needle = $('amp')?.querySelector('.amp-vu-needle');
      if (needle) {
        needle.style.transform = `rotate(${(-50 + vuLevel * 100).toFixed(1)}deg)`;
        const vu = needle.closest('.amp-vu');
        if (vu) vu.classList.toggle('peaking', lvl > 0.85);
      }

      // CH1/CH2 input meters — only while the settings panel is open (cheap-out
      // otherwise). Each taps its own splitter output so both are always live.
      if (chMeters && $('settings-panel')?.classList.contains('open')) {
        for (let c = 0; c < 2; c++) {
          const fill = $(`ch${c + 1}-meter`);
          if (fill) fill.style.width = Math.min(100, analyserPeak(chMeters[c], chBuf) * 100 * 1.6) + '%';
        }
      }

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
    // Safari: 'interactive' still yields a conservative buffer; an explicit
    // numeric hint (seconds) asks for the hardware minimum — WebKit clamps it
    // to what the device can do, so 0.005 is safe. Chrome already gives its
    // minimum for 'interactive'.
    //
    // Safari + rate mismatch: WebKit's AudioContext follows the OUTPUT device
    // rate (often 44.1k), while an audio interface capturing at 48k then goes
    // through WebKit's slow input resampler — a known chunk of Safari's extra
    // input latency (Chromium resamples in small buffers). Pin the context to
    // the INPUT track's real rate so the capture path is 1:1; any resample
    // moves to the output side, which CoreAudio handles cheaply.
    const trackRate = (() => {
      try { return stream.getAudioTracks()[0].getSettings().sampleRate || 0; } catch { return 0; }
    })();
    ctx = new AudioContext({
      latencyHint: isSafari ? 0.005 : 'interactive',
      ...(isSafari && trackRate ? { sampleRate: trackRate } : {}),
    });
    await ctx.resume();

    // Preload AudioWorklet processors (pitch shift, looper) before any chain is
    // built, so their nodes can be constructed synchronously in buildChain.
    try { await loadWorklets(ctx); } catch (e) { console.warn('worklet load failed:', e); }

    $('sr').textContent = ctx.sampleRate + ' Hz';
    // Diagnose the input path: a track-vs-context rate mismatch means an input
    // resampler sits in the capture path (extra latency, worst on Safari).
    { const d = $('diag');
      if (d) d.textContent = `${isSafari ? 'Safari' : 'Chrome'} · in ${trackRate || '?'} Hz → ctx ${ctx.sampleRate} Hz${trackRate && trackRate !== ctx.sampleRate ? ' (RESAMPLING)' : ''} · buf ${Math.round((ctx.baseLatency || 0) * ctx.sampleRate)} frames (${((ctx.baseLatency || 0) * 1000).toFixed(1)} ms)`;
    }

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

    // Per-hardware-channel meters (CH1/CH2) shown beside the input-channel
    // selector. They tap BOTH splitter outputs (not the selected one) so the
    // user can see which physical input their guitar is on. Re-attached in
    // routeInputChannel() because connectInputChannel() clears the splitter.
    chMeters = [ctx.createAnalyser(), ctx.createAnalyser()];
    for (const a of chMeters) a.fftSize = 1024;

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
  chainStore.saveHasStarted(); // first successful power-on retires the Start-here hint
  document.documentElement.classList.add('has-started');
    // One-shot power-on ritual: tubes warm up, then the chain connectors light
    // once left→right and settle (≤2s; skipped under prefers-reduced-motion).
    playPowerOnRitual();
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
    normGainValue: () => (normGain ? normGain.gain.value : null),
    normApplyCount: () => loudness.applyCount(),
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
    // Set a param on the first pedal of `type` (drives the effect-viz shots).
    setPedalParam: (type, key, value) => {
      const u = currentChain.find((x) => x.type === type && !x.locked);
      if (!u) throw new Error('no pedal of type ' + type);
      setParamLive(u.instanceId, key, value);
      return true;
    },
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
  restoreFoldIfIdle(); // power-off ends any transport — un-fold the panels
  { const r = $('tp-record'); if (r) { r.disabled = true; r.classList.remove('recording'); r.title = 'Record — available with recording'; } }
  stopCalibration();
  $('meter').style.width = '0%';
  { const c = $('note-circle'); if (c) { c.textContent = '—'; c.classList.remove('active'); } }
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  loudness.reset(); // next power-on MUST re-measure; void in-flight measures
  ctx = stream = source = engine = gainOut = normGain = analyser = calibrationEq = reverbStage = inputSplitter = null;
  chMeters = null; vuLevel = 0;
  { const n = $('amp')?.querySelector('.amp-vu-needle'); if (n) n.style.transform = 'rotate(-50deg)'; }
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
  // Re-fan the CH1/CH2 meter taps (connectInputChannel's disconnect cleared them).
  if (chMeters) { inputSplitter.connect(chMeters[0], 0); inputSplitter.connect(chMeters[1], 1); }
}

// Re-route the live input to a different hardware channel (1 or 2). Persists the
// selection so it survives power cycles; no-op on the graph until Start wires it.
function setInputChannel(ch) {
  inputChannel = Math.min(1, Math.max(0, ch | 0));
  chainStore.saveInputChannel(inputChannel); // survives reloads, not just power cycles
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
$('input-channel').value = String(inputChannel); // reflect the remembered channel
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
  $('preset-browser') && ($('preset-browser').inert = hidden); // collapsed sidebar is off the a11y/tab path
  chainStore.savePresetsHidden(hidden);
  // The toolbar button is the sidebar's expand/collapse control on wide screens.
  $('presets-toggle')?.setAttribute('aria-expanded', String(!hidden));
}
const isNarrow = () => window.matchMedia('(max-width: 1040px)').matches;
$('presets-toggle').addEventListener('click', () => {
  if (isNarrow()) setPresets(!document.body.classList.contains('presets-open'));
  else setPresetsHidden(!document.body.classList.contains('presets-hidden'));
});
$('presets-close').addEventListener('click', () => setPresets(false));
$('presets-backdrop').addEventListener('click', () => setPresets(false));
if (chainStore.loadPresetsHidden()) { document.body.classList.add('presets-hidden'); $('preset-browser') && ($('preset-browser').inert = true); }
$('presets-toggle')?.setAttribute('aria-expanded', String(!chainStore.loadPresetsHidden()));
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
  // Tempo drives the ruler grid + beat snap — re-render the lane on change.
  onTempoChange: (n) => { uiBpm = n; renderTrack(); if (tabLane) tabLane.setBpm(n); },
});

// ── TAB transcription (offline) + editor ───────────────────────────────────
// Right-click a recorded clip → "Transcribe → TAB": the whole take is analysed
// at once (offline-transcribe.js) and rendered into an EDITABLE lane above the
// amp. The player then corrects it — drag a note to another string (pitch
// preserved, fret recomputed) or double-click the number to retype it. Every
// note keeps its originally-detected value beside the corrected one, so a
// finished tab is a labelled training pair (audio + human-verified notes),
// downloadable via Export.
let tabLane = null;        // persists until ✕ — the transcription stays readable
let tabAudio = null;       // { samples, sampleRate, label } of the shown clip, for export
let tabTake = null;        // take whose `.tab` we keep in sync with edits (in-memory)

function closeTabLane() { tabMidi.stop(); tabLane?.destroy(); tabLane = null; tabAudio = null; tabTake = null; }

function ensureTabLane() {
  const laneEl = $('tab-lane');
  if (!laneEl) return false;
  if (!tabLane) {
    tabLane = mountTabLane(laneEl, { bpm: uiBpm });
    tabLane.onClear(() => { tabLane.clear(); if (tabTake) tabTake.tab = tabLane.serialize(); });
    tabLane.onClose(() => closeTabLane());
    tabLane.onChange((model) => { if (tabTake) tabTake.tab = model; });   // corrections persist on the take
    tabLane.onExport(() => exportTabTraining());
    tabLane.onPlay(() => toggleTabMidi());                                // strip Play → hear the TAB as MIDI
  }
  return true;
}

// Play the TAB itself as synthesized notes (independent of the recording).
// The lane cursor rides along. Toggles; stops any transport playback first so
// you don't hear both at once.
function toggleTabMidi() {
  if (!tabLane) return;
  if (tabMidi.isPlaying()) { tabMidi.stop(); tabLane.hidePlayhead(); tabLane.setPlaying(false); return; }
  const notes = tabLane.getNotes();
  if (!notes.length) return;
  if (player.isPlaying()) { player.stop(); reflectPlay(); tabLane.hidePlayhead(); }
  tabLane.setPlaying(true);
  tabMidi.play(notes, {
    onTick: (t) => tabLane.setPlayhead(t),
    onEnd: () => { tabLane.hidePlayhead(); tabLane.setPlaying(false); },
  });
}

// While the TRANSPORT plays the real recording, ride the tab cursor in sync.
// The tab is anchored to its source clip: transport second `pos` maps to tab
// second `pos − clipStart`; show the cursor only across the clip's span.
function tabCursorFromTransport(pos) {
  if (!tabLane || !tabTake) return;
  const start = (tabTake.x || 0) / PX_PER_SEC;
  const dur = (tabTake.len != null ? tabTake.len : tabTake.duration) || 0;
  const t = tabTimeForTransport(pos, start, dur);
  if (t == null) tabLane.hidePlayhead(); else tabLane.setPlayhead(t);
}
function transportTick(pos) { setPlayhead(pos); tabCursorFromTransport(pos); }

function renderNotesToLane(notes) {
  tabLane.clear();
  tabLane.setBpm(uiBpm);
  let prev = null;
  for (const nt of notes) {
    const pos = assignFret(nt.midi, prev);
    if (!pos) continue;
    prev = pos;
    // carry the PITCH + timing so string-drags preserve pitch and export can
    // pair each note with its moment in the audio
    tabLane.noteOn(pos.string, pos.fret, quantizeToGrid(nt.tSec, uiBpm), { midi: nt.midi, tSec: nt.tSec, durSec: nt.durSec });
  }
}

function transcribeSamplesToLane(samples, sampleRate, label, take) {
  if (!ensureTabLane()) return 0;
  tabMidi.stop(); tabLane.hidePlayhead(); tabLane.setPlaying(false);
  const { notes } = transcribeTake(samples, sampleRate);
  renderNotesToLane(notes);
  tabAudio = { samples, sampleRate, label: label || 'clip' };
  tabTake = take || null;
  if (tabTake) tabTake.tab = tabLane.serialize();
  tabLane.setLive(false, `${label || 'transcribed clip'} — ${notes.length} notes · drag to fix strings, double-click to edit`);
  return notes.length;
}

function transcribeClipToLane(trackId, n) {
  const tr = tracks.find((k) => k.id === trackId);
  const tk = tr && tr.takes.find((k) => k.n === n);
  if (!tk || !tk.samples || !tk.samples.length) return;
  // transcribe the TRIMMED window — what the clip actually plays. Copy the
  // view so the exported audio stays stable regardless of later trims.
  const sr = tk.sampleRate;
  const from = Math.max(0, Math.floor((tk.offset || 0) * sr));
  const len = Math.floor(((tk.len != null ? tk.len : tk.duration) || 0) * sr);
  const seg = tk.samples.subarray(from, Math.min(tk.samples.length, from + Math.max(1, len))).slice();
  transcribeSamplesToLane(seg, sr, `clip ${n}`, tk);
  $('tab-lane')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Export a training example: the clip audio (WAV) + the corrected notes, each
// tagged with what the engine detected vs what the human confirmed. A single
// self-contained JSON so a future model can learn from real, labelled guitar.
function base64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportTabTraining() {
  if (!tabLane || !tabAudio) return;
  const model = tabLane.serialize();
  const wav = encodeWav(tabAudio.samples, tabAudio.sampleRate);
  const bundle = {
    version: 1,
    source: 'guitar-web tab editor',
    label: tabAudio.label,
    sampleRate: tabAudio.sampleRate,
    bpm: model.bpm,
    tuning: model.tuning,
    durationSec: tabAudio.samples.length / tabAudio.sampleRate,
    editedCount: model.notes.filter((n) => n.edited).length,
    notes: model.notes,                 // {tSec,durSec, detMidi/detString/detFret, midi/string/fret, edited}
    audioWavBase64: base64FromBuffer(wav),
  };
  const name = `tab-${(tabAudio.label || 'clip').replace(/\s+/g, '-')}.json`;
  downloadBlob(new Blob([JSON.stringify(bundle)], { type: 'application/json' }), name);
  if (window.__tabDebug) window.__tabDebug.lastExport = { name, bytes: bundle.audioWavBase64.length, notes: bundle.notes.length };
}

if ($('diag')) window.__tabDebug = {
  count: () => (tabLane ? tabLane.noteCount() : -1),
  notes: () => (tabLane ? tabLane.getNotes() : []),
  serialize: () => (tabLane ? tabLane.serialize() : null),
  // Test-only: run the offline pipeline on synthesized samples and render.
  offline(arr, sr) { return transcribeSamplesToLane(Float32Array.from(arr), sr, 'e2e', null); },
  // Test-only: exercise the editor by note INDEX (sorted by col then string).
  moveToString(idx, string) { if (!tabLane) return false; const n = tabLane.getNotes()[idx]; return n ? tabLane.moveNoteToString(n.id, string) : false; },
  setFret(idx, fret) { if (!tabLane) return false; const n = tabLane.getNotes()[idx]; return n ? tabLane.setNoteFret(n.id, fret) : false; },
  export: () => exportTabTraining(),
  // Test-only: playback state — MIDI player + cursor visibility.
  playMidi: () => toggleTabMidi(),
  midiPlaying: () => tabMidi.isPlaying(),
  cursorShown: () => { const c = document.querySelector('.tab-cursor'); return !!c && c.style.opacity === '1'; },
  playingNotes: () => document.querySelectorAll('.tab-note.playing').length,
};

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
      if (player.isPlaying()) player.stop(); // stop the overdub backing playback
      transport.endSession();
      recBtn.classList.remove('recording');
      restoreFoldIfIdle(); // transport idle again — un-fold to the pre-record state
      if (t && t.samples.length) {
        pushUndo();
        // Recording-latency compensation: drop the monitoring-delay head so the
        // performance sits ON the grid instead of behind it (see take-ops.js).
        const trimSec = recordHeadTrimSec({
          playerT0: recBackingT0, capStart: recCapStart,
          baseLatency: ctx && ctx.baseLatency, outputLatency: ctx && ctx.outputLatency,
        });
        const cut = Math.min(t.samples.length, Math.round(trimSec * t.sampleRate));
        const samples = cut > 0 ? t.samples.subarray(cut) : t.samples;
        const duration = samples.length / t.sampleRate;
        if ($('diag')) window.__lastRecordDebug = { t0: recBackingT0, capStart: recCapStart, trimSec, sr: t.sampleRate }; // e2e/inspection
        recBackingT0 = null;
        const newStart = recStartX / PX_PER_SEC;
        punchOver(track, newStart, newStart + duration); // overwrite overlapped audio
        track.takes.push({ ...t, samples, duration, n: ++takeSeq, name: track.name, x: recStartX, offset: 0, len: duration });
        renderTrack();
        updateTransport();
      }
    } else {
      if (player.isPlaying()) { player.stop(); reflectPlay(); }
      autoFold.fold(); // free the vertical space for the take (incl. the count-in)
      // Actually begin capture + grow the live clip. Deferred past the count-in.
      const begin = () => {
        recBtn.classList.remove('counting');
        if (!ctx || recorder.isRecording()) return;
        recorder.start();
        recBtn.classList.add('recording');
        // Recording starts AT the playhead (where the user parked it), not at
        // the end of the track. The clip + the stored take share this anchor.
        const startSec = Math.max(0, playheadSec);
        // Overdub: play back every OTHER track from the same anchor so you can
        // record along to what's already there. The armed track is excluded —
        // its audio in this region is about to be overwritten (punchOver). The
        // record loop below owns the playhead, so the player gets no-op
        // tick/end callbacks and never fights it or resets it on backing-end.
        const backing = buildGroups().filter((g) => g.id !== track.id);
        recBackingT0 = null;
        if (backing.some((g) => (g.takes || []).length)) recBackingT0 = player.play(backing, startSec, () => {}, () => {});
        recCapStart = ctx.currentTime; // recorder capture begins ~now (same clock)
        // Grow a purple clip in real time in the armed track's strip.
        const area = $('track-lane') && $('track-lane').querySelector(`.track-strip[data-track-id="${track.id}"]`);
        if (area) {
          const startT = ctx.currentTime;
          const x = Math.round(startSec * PX_PER_SEC); recStartX = x; // BASE px (model)
          liveClip = document.createElement('div');
          liveClip.className = 'track-clip recording-clip';
          liveClip.style.cssText = `left:${Math.round(x * zoomLevel)}px;top:6px;height:80px;width:0px`;
          const lbl = document.createElement('div'); lbl.className = 'clip-label'; lbl.textContent = `${track.name || 'Take'} #${takeSeq + 1}`;
          const canvas = document.createElement('canvas'); canvas.className = 'clip-wave'; canvas.height = 80;
          liveClip.append(lbl, canvas);
          area.appendChild(liveClip);
          let lastDraw = 0;
          const grow = () => {
            if (!liveClip) return;
            const elapsed = ctx.currentTime - startT;
            const w = Math.max(0, elapsed * PX_PER_SEC * zoomLevel); // view px
            liveClip.style.width = `${w}px`;
            setPlayhead(startSec + elapsed); // playhead rides the leading edge while recording
            ensureRulerBars($('track-lane'), startSec + elapsed, uiBpm, zoomLevel); // grid never ends
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
    if (player.isPlaying()) { player.stop(); reflectPlay(); tabLane?.hidePlayhead(); restoreFoldIfIdle(); return; }
    if (!allTakes().length) return;
    if (tabMidi.isPlaying()) { tabMidi.stop(); tabLane?.setPlaying(false); } // don't stack two players
    // transportTick sweeps the timeline playhead AND rides the tab cursor in sync.
    player.play(buildGroups(), playheadSec, transportTick, () => { reflectPlay(); setPlayhead(0); tabLane?.hidePlayhead(); restoreFoldIfIdle(); });
    reflectPlay();
    autoFold.fold(); // playback started — free the vertical space for the tracks
  });

  // Skip to start: stop playback and park the playhead at bar 1.
  const skipBtn = $('tp-start');
  if (skipBtn) skipBtn.addEventListener('click', () => {
    player.stop(); reflectPlay(); setPlayhead(0); tabLane?.hidePlayhead(); restoreFoldIfIdle();
  });

  // Seek + scrub: click an empty part of the timeline to move the playhead, or
  // press-drag the ruler / playhead grip to scrub. Snaps to grid when enabled.
  // Clicks on a clip are ignored (clips handle their own drag).
  const lane = $('track-lane');
  function seekToClientX(clientX, free) {
    const tl = lane.querySelector('.track-timeline');
    if (!tl) return;
    const x = e_x(clientX, tl) / zoomLevel; // view px → base (model) px
    player.stop(); reflectPlay(); tabLane?.hidePlayhead(); restoreFoldIfIdle();
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
    // Right-click: track header → track menu; clip → Copy/Paste/Split/Delete;
    // empty strip → Paste.
    lane.addEventListener('contextmenu', (e) => {
      const header = e.target.closest('.track-header');
      if (header && header.dataset.trackId) {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, trackMenuItems(Number(header.dataset.trackId)));
        return;
      }
      const clip = e.target.closest('.track-clip');
      if (clip && clip.dataset.takeId) {
        e.preventDefault();
        const tid = Number(clip.dataset.trackId), n = Number(clip.dataset.takeId);
        // If the right-clicked clip is part of a multi-selection, Delete removes
        // the whole selection; otherwise just this clip.
        const sel = getSelectedClips();
        const inSel = sel.some((s) => s.trackId === tid && s.n === n);
        const targets = inSel && sel.length > 1 ? sel : [{ trackId: tid, n }];
        // Looped clips don't split (v1) — splitTakeAt rejects them — so grey
        // the item out rather than leave a silent no-op.
        const ctxTrack = tracks.find((k) => k.id === tid);
        const ctxTake = ctxTrack && ctxTrack.takes.find((k) => k.n === n);
        openCtxMenu(e.clientX, e.clientY, [
          ctxItem(targets.length > 1 ? `Copy ${targets.length} clips` : 'Copy', () => copyClips(targets)),
          ctxItem('Paste at playhead', () => pasteClipboard(tid), !clipboard),
          ctxItem('Split at playhead', () => splitClip(tid, n), !!(ctxTake && ctxTake.repeat > 1)),
          ctxItem('Transcribe → TAB', () => transcribeClipToLane(tid, n)),
          ctxItem(targets.length > 1 ? `Delete ${targets.length} clips` : 'Delete', () => deleteClips(targets)),
        ]);
        return;
      }
      const strip = e.target.closest('.track-strip');
      if (strip && strip.dataset.trackId) {
        e.preventDefault();
        openCtxMenu(e.clientX, e.clientY, [ctxItem('Paste at playhead', () => pasteClipboard(Number(strip.dataset.trackId)), !clipboard)]);
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

// "Come Together" jam UI lives in src/jam-ui.js.
initJamUI({ getCtx: () => ctx, getSendNode: () => normGain });
