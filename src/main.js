// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset, GB_CATEGORIES } from './presets.js';
import { renderPresetPicker } from './ui.js';
import { renderPresetBrowser } from './preset-browser.js';
import { renderPedalboard } from './chain-ui/pedalboard.js';
import { renderAmp } from './chain-ui/amp.js';
import { createCalibrationEq } from './calibration/calibration-eq.js';
import { computeCorrection } from './calibration/correction.js';
import { bandPowersFromMagnitudes } from './calibration/bands.js';
import { createAccumulator, accumulate, fingerprint, coverage } from './calibration/analyzer.js';
import * as profiles from './calibration/profiles.js';
import { renderCalibrationControls } from './calibration/ui.js';
import { autoCorrelate } from './pitch/detector.js';
import { freqToNote, noteLabel } from './pitch/note.js';
import { fingerprintToStats, archetype } from './profile-card/attributes.js';
import { renderProfileCard } from './profile-card/ui.js';
import { spectrumBars } from './spectrum.js';
import { measureLoudnessGain } from './normalize.js';
import { mountTransport } from './transport-ui.js';
import { renderTrackLane, PX_PER_SEC } from './track-lane.js';
import { createRecorder } from './recorder.js';
import { createPlayer } from './player.js';
import { drawWaveform } from './waveform.js';
import * as chainState from './chain-state.js';
import * as chainStore from './chain-store.js';
import { loadWorklets } from './effects/worklets/index.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut, normGain, analyser, rafId;
let calibrationEq, calibRAF, calibState, calibCountdown;
let pitchBuf, lastNoteMs = 0;
let prevBars = null;
let accentRGB = '255,159,10'; // current theme accent for canvas drawing

let tracks = [];         // [{ id, name, armed, takes: [] }]
let nextTrackId = 1;     // track id source
let armedId = null;      // the record-armed track
let takeSeq = 0;         // running take number for clip labels (global)
let liveRAF = null, liveClip = null; // in-progress (growing) recording clip
// Tap normGain (post loudness-normalization, pre Vol) so the take matches what
// you hear and is independent of the master Vol slider.
const recorder = createRecorder({ getSource: () => normGain, getContext: () => ctx });
const player = createPlayer();

const armedTrack = () => tracks.find((t) => t.id === armedId) || null;
const allTakes = () => tracks.flatMap((t) => t.takes);
// x offset (px) where the next clip starts in a track: end of its last take.
function nextClipX(track) {
  return (track ? track.takes : []).reduce((acc, k) => acc + Math.max(8, Math.round((k.duration || 0) * PX_PER_SEC)), 0);
}
let playheadSec = 0;
// Move the playhead to a time position (seconds) on the track lane.
function setPlayhead(sec) {
  playheadSec = Math.max(0, sec || 0);
  const ph = $('track-lane') && $('track-lane').querySelector('.track-playhead');
  if (ph) ph.style.left = `${playheadSec * PX_PER_SEC}px`;
}
// Enable play/skip once there is something to play.
function updateTransport() {
  const has = allTakes().length > 0;
  const play = $('tp-play'), skip = $('tp-start');
  if (play) { play.disabled = !has; play.title = has ? 'Play' : 'Play — record something first'; }
  if (skip) { skip.disabled = !has; skip.title = has ? 'Skip to start' : 'Skip to start'; }
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

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

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
    if (normGain) engine.output.connect(normGain);
  }

  try {
    renderAmp($('amp'), locked, setParamLive);
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
  const r = chainState.fromPreset(preset.chain, nextId);
  currentChain = r.chain; nextId = r.nextId;
  activePresetName = preset.name;
  rebuildGraph();
  renderBrowser();
  renderTrack();
  setPresets(false); // close the drawer after picking (narrow screens)
}

function renderBrowser() {
  const el = $('preset-browser');
  if (el) renderPresetBrowser(el, GB_CATEGORIES, loadPreset, activePresetName);
}

let snapOn = true;
const SNAP_PX = 16; // one beat (0.5s @ 120 BPM 4/4) at 32 px/sec
function snapPx(x) { return snapOn ? Math.round(x / SNAP_PX) * SNAP_PX : x; }

function renderTrack() {
  const el = $('track-lane');
  if (!el) return;
  renderTrackLane(el, {
    tracks,
    armedId,
    snap: snapOn,
    onToggleSnap: () => { snapOn = !snapOn; renderTrack(); },
    onAddTrack: () => {
      const t = { id: nextTrackId++, name: activePresetName || 'Track', armed: true, takes: [] };
      tracks.forEach((k) => { k.armed = false; });
      t.armed = true; armedId = t.id; tracks.push(t);
      renderTrack();
    },
    onRemoveTrack: (id) => {
      tracks = tracks.filter((t) => t.id !== id);
      if (armedId === id) armedId = tracks.length ? tracks[tracks.length - 1].id : null;
      tracks.forEach((t) => { t.armed = t.id === armedId; });
      renderTrack(); updateTransport();
    },
    onArm: (id) => { armedId = id; tracks.forEach((t) => { t.armed = t.id === id; }); renderTrack(); },
    onMoveClip: (trackId, n, x) => {
      const t = tracks.find((k) => k.id === trackId); const tk = t && t.takes.find((k) => k.n === n);
      if (tk) { tk.x = Math.max(0, Math.round(snapPx(x))); renderTrack(); }
    },
    onDeleteClip: (trackId, n) => {
      const t = tracks.find((k) => k.id === trackId);
      if (t) { t.takes = t.takes.filter((k) => k.n !== n); renderTrack(); updateTransport(); }
    },
  });
}

// Restore a persisted chain (array of {type, params}) into the model.
function loadStoredChain(data) {
  const valid = data.filter((e) => registry[e.type]); // drop unknown types defensively
  const r = chainState.fromPreset(valid, nextId);
  currentChain = r.chain; nextId = r.nextId;
  rebuildGraph();
}

// Re-measure loudness normalization whenever the chain STRUCTURE changes
// (debounced). Param-only edits keep the signature, so they don't re-measure.
function scheduleNormalize() {
  if (!normGain) return;
  const sig = chainState.signature(currentChain);
  if (sig === normSig) return;
  normSig = sig;
  clearTimeout(normTimer);
  normTimer = setTimeout(async () => {
    try {
      const g = await measureLoudnessGain(chainState.toEngineChain(currentChain), { sampleRate: ctx ? ctx.sampleRate : 48000 });
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

function drawSpectrum(freqBytes) {
  const canvas = $('spectrum');
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  c.clearRect(0, 0, W, H);

  // Subtle scan grid: 3 horizontal + 7 vertical
  c.strokeStyle = 'rgba(255,255,255,0.022)'; c.lineWidth = 1;
  for (let i = 1; i < 4; i++) { const y = Math.round(H / 4 * i) + 0.5; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  for (let i = 1; i < 8; i++) { const x = Math.round(W / 8 * i) + 0.5; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }

  const N = 80;
  let bars = spectrumBars(freqBytes, N);

  // Temporal smoothing: 40% new + 60% previous frame
  if (prevBars) bars = bars.map((v, i) => v * 0.4 + prevBars[i] * 0.6);
  prevBars = [...bars];

  // Gaussian smooth across adjacent bins (7-tap)
  const sm = bars.map((_, i) => {
    const w = [0.06, 0.12, 0.22, 0.28, 0.22, 0.12, 0.06];
    let s = 0, wt = 0;
    w.forEach((ww, o) => { const idx = i + o - 3; if (idx >= 0 && idx < N) { s += bars[idx] * ww; wt += ww; } });
    return s / wt;
  });

  const pts = sm.map((v, i) => ({ x: (i / (N - 1)) * W, y: H - v * H * 0.92 }));

  // Filled area (cubic Bézier, control points at x midpoints). Colored by the
  // active theme's accent.
  const a = accentRGB;
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `rgba(${a},0.75)`);
  grad.addColorStop(0.25, `rgba(${a},0.5)`);
  grad.addColorStop(0.65, `rgba(${a},0.18)`);
  grad.addColorStop(1, `rgba(${a},0)`);
  c.beginPath(); c.moveTo(0, H);
  pts.forEach((p, i) => { if (i === 0) c.lineTo(p.x, p.y); else { const px = pts[i - 1]; c.bezierCurveTo((px.x + p.x) / 2, px.y, (px.x + p.x) / 2, p.y, p.x, p.y); } });
  c.lineTo(W, H); c.closePath(); c.fillStyle = grad; c.fill();

  // Mirror reflection (subtle)
  const rGrad = c.createLinearGradient(0, H, 0, H - H * 0.2);
  rGrad.addColorStop(0, `rgba(${a},0.08)`); rGrad.addColorStop(1, `rgba(${a},0)`);
  c.beginPath(); c.moveTo(0, H);
  pts.forEach((p, i) => { const ry = H + (H - p.y) * 0.18; if (i === 0) c.lineTo(p.x, ry); else { const px = pts[i - 1]; const pry = H + (H - px.y) * 0.18; c.bezierCurveTo((px.x + p.x) / 2, pry, (px.x + p.x) / 2, ry, p.x, ry); } });
  c.lineTo(W, H); c.closePath(); c.fillStyle = rGrad; c.fill();

  // Glowing top edge
  c.save();
  c.shadowColor = `rgba(${a},0.7)`; c.shadowBlur = 8;
  c.beginPath();
  pts.forEach((p, i) => { if (i === 0) c.moveTo(p.x, p.y); else { const px = pts[i - 1]; c.bezierCurveTo((px.x + p.x) / 2, px.y, (px.x + p.x) / 2, p.y, p.x, p.y); } });
  c.strokeStyle = `rgba(${a},0.7)`; c.lineWidth = 1.5; c.stroke();
  c.restore();

  // Peak frequency readout
  let peakBin = 0, peakV = 0;
  sm.forEach((v, i) => { if (v > peakV) { peakV = v; peakBin = i; } });
  const fl = $('freq-label');
  if (fl && peakV > 0.08 && ctx && analyser) {
    const binHz = ctx.sampleRate / (2 * analyser.frequencyBinCount);
    const peakHz = Math.round(peakBin / N * analyser.frequencyBinCount * binHz);
    fl.style.color = `rgba(${a},${Math.min(0.6, peakV * 1.5)})`;
    fl.textContent = peakHz < 1000 ? `${peakHz} Hz` : `${(peakHz / 1000).toFixed(1)} kHz`;
  }
}

function startMeter() {
  const timeBuf = new Uint8Array(analyser.fftSize);
  const freqBuf = new Uint8Array(analyser.frequencyBinCount);
  pitchBuf = new Float32Array(analyser.fftSize);
  function loop() {
    rafId = requestAnimationFrame(loop);
    // input meter (time-domain bytes)
    analyser.getByteTimeDomainData(timeBuf);
    let peak = 0;
    for (let i = 0; i < timeBuf.length; i++) {
      const v = Math.abs(timeBuf[i] - 128);
      if (v > peak) peak = v;
    }
    $('meter').style.width = Math.min(100, peak / 128 * 100 * 1.5) + '%';
    // note detection (float time-domain)
    analyser.getFloatTimeDomainData(pitchBuf);
    const f = autoCorrelate(pitchBuf, ctx.sampleRate);
    const circle = $('note-circle');
    if (f > 0) {
      lastNoteMs = performance.now();
      circle.textContent = noteLabel(freqToNote(f));
      circle.classList.add('active');
    } else if (performance.now() - lastNoteMs > 1200) {
      // Keep the last note name visible; just dim it once the note has stopped ringing.
      circle.classList.remove('active');
    }
    // live spectrum (frequency-domain)
    analyser.getByteFrequencyData(freqBuf);
    drawSpectrum(freqBuf);
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

    // Analyser tap off source (read-only; not in the effects path). Used by both the
    // input meter (time-domain) and calibration capture (frequency-domain).
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    gainOut = ctx.createGain();
    gainOut.gain.value = parseFloat($('gain').value);
    gainOut.connect(ctx.destination);

    // Per-preset loudness normalization sits before the user Vol control:
    // engine.output -> normGain -> gainOut -> destination.
    normGain = ctx.createGain();
    normGain.gain.value = 1;
    normGain.connect(gainOut);

    // Calibration EQ sits between source and the artist chain.
    calibrationEq = createCalibrationEq(ctx);
    source.connect(calibrationEq.input);
    applyActiveCalibration();

    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    // The chain may already be populated (edited before Start). If so, just wire
    // the existing model to audio; otherwise fall back to the default preset.
    if (currentChain.length === 0) loadPreset(defaultPreset);
    else rebuildGraph();
    const sel = $('presets').querySelector('select');
    if (sel) sel.selectedIndex = PRESETS.indexOf(defaultPreset);

    renderCalibControls();
    startMeter();
    showStats();
    setTimeout(showStats, 600);

    $('start').disabled = true; $('stop').disabled = false;
    { const r = $('tp-record'); if (r) { r.disabled = false; r.title = 'Record'; } }
    $('status').textContent = 'Live — play your guitar'; $('status').classList.add('live'); $('status-dot').classList.add('live');
    listDevices();
  } catch (e) {
    $('error').textContent = 'Could not start: ' + e.message;
    console.error(e);
  }
}

function stop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (recorder.isRecording()) recorder.stop();
  if (player.isPlaying()) { player.stop(); const pb = $('tp-play'); if (pb) pb.classList.remove('on'); }
  clearLiveClip();
  { const r = $('tp-record'); if (r) { r.disabled = true; r.classList.remove('recording'); r.title = 'Record — available with recording'; } }
  stopCalibration();
  $('meter').style.width = '0%';
  { const c = $('note-circle'); if (c) { c.textContent = '—'; c.classList.remove('active'); } }
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = normGain = analyser = calibrationEq = null;
  $('start').disabled = false; $('stop').disabled = true;
  prevBars = null;
  { const fl = $('freq-label'); if (fl) { fl.textContent = '— Hz'; fl.style.color = ''; } }
  $('status').textContent = 'Stopped'; $('status').classList.remove('live'); $('status-dot').classList.remove('live');
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

$('gain').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (gainOut) gainOut.gain.value = v;
  const gl = $('gain-label'); if (gl) gl.textContent = v.toFixed(1) + '×';
});
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('calib-save').addEventListener('click', saveCalibration);
$('calib-cancel').addEventListener('click', stopCalibration);
$('calib-start').addEventListener('click', startCalibration);

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
$('presets-toggle').addEventListener('click', () => setPresets(!document.body.classList.contains('presets-open')));
$('presets-close').addEventListener('click', () => setPresets(false));
$('presets-backdrop').addEventListener('click', () => setPresets(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setSettings(false); setPresets(false); } });
$('diag').textContent = `${isSafari ? 'Safari' : 'Chrome'} · setSinkId: ${hasSetSinkId ? 'yes' : 'no'}`;

// Read the theme accent once for canvas drawing (the spectrum).
accentRGB = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '255,159,10';

navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});

// Initialize the editable chain on load (works before Start; audio wires up on
// Start). Restore a persisted chain if present, else load the default preset.
(function initChain() {
  const stored = chainStore.load();
  if (stored && Array.isArray(stored) && stored.length) loadStoredChain(stored);
  else loadPreset(PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0]);
  renderBrowser();
  // Start with one armed track named after the active preset.
  tracks = [{ id: nextTrackId++, name: activePresetName || 'Track', armed: true, takes: [] }];
  armedId = tracks[0].id;
  renderTrack();
})();

// Toolbar transport cluster: inert transport (ground for recording) + working
// metronome and tuner. The tuner taps the live engine analyser when running.
mountTransport($('transport-cluster'), { getLiveAnalyser: () => analyser });

// Record: capture the live processed output into a take, append it as a clip.
{
  const recBtn = $('tp-record');
  if (recBtn) recBtn.addEventListener('click', () => {
    if (!ctx) return; // only while live
    const track = armedTrack();
    if (!track) return; // need an armed track to record into
    if (recorder.isRecording()) {
      clearLiveClip();
      const t = recorder.stop();
      recBtn.classList.remove('recording');
      if (t && t.samples.length) {
        track.takes.push({ ...t, n: ++takeSeq, name: track.name, x: nextClipX(track) });
        renderTrack();
        updateTransport();
      }
    } else {
      if (player.isPlaying()) { player.stop(); $('tp-play').classList.remove('on'); }
      recorder.start();
      recBtn.classList.add('recording');
      // Grow a purple clip in real time in the armed track's strip.
      const area = $('track-lane') && $('track-lane').querySelector(`.track-strip[data-track-id="${track.id}"]`);
      if (area) {
        const startT = ctx.currentTime, x = nextClipX(track);
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
          const w = Math.max(0, (ctx.currentTime - startT) * PX_PER_SEC);
          liveClip.style.width = `${w}px`;
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
    }
  });

  // Play / Stop playback of recorded takes; the playhead sweeps the timeline.
  const playBtn = $('tp-play');
  if (playBtn) playBtn.addEventListener('click', () => {
    if (player.isPlaying()) { player.stop(); playBtn.classList.remove('on'); return; }
    const flat = allTakes();
    if (!flat.length) return;
    playBtn.classList.add('on');
    player.play(flat, playheadSec, setPlayhead, () => { playBtn.classList.remove('on'); setPlayhead(0); });
  });

  // Skip to start: stop playback and park the playhead at bar 1.
  const skipBtn = $('tp-start');
  if (skipBtn) skipBtn.addEventListener('click', () => {
    player.stop(); if (playBtn) playBtn.classList.remove('on'); setPlayhead(0);
  });

  // Seek + scrub: click an empty part of the timeline to move the playhead, or
  // press-drag the ruler / playhead grip to scrub. Snaps to grid when enabled.
  // Clicks on a clip are ignored (clips handle their own drag).
  const lane = $('track-lane');
  function seekToClientX(clientX) {
    const tl = lane.querySelector('.track-timeline');
    if (!tl) return;
    const x = e_x(clientX, tl);
    player.stop(); playBtn.classList.remove('on');
    setPlayhead(snapPx(Math.max(0, x)) / PX_PER_SEC);
  }
  function e_x(clientX, tl) { return clientX - tl.getBoundingClientRect().left + tl.scrollLeft; }
  if (lane) {
    lane.addEventListener('click', (e) => {
      if (e.target.closest('.track-clip')) return;
      const tl = lane.querySelector('.track-timeline');
      if (!tl || !tl.contains(e.target)) return;
      seekToClientX(e.clientX);
    });
    lane.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.track-clip')) return;
      if (!e.target.closest('.track-ruler') && !e.target.closest('.playhead-grip')) return;
      seekToClientX(e.clientX);
      const move = (ev) => seekToClientX(ev.clientX);
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      e.preventDefault();
    });
  }

  updateTransport();
}
