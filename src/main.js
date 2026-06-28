// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset } from './presets.js';
import { renderPresetPicker } from './ui.js';
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
import { resolveTheme } from './theme.js';
import { spectrumBars } from './spectrum.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut, analyser, rafId;
let calibrationEq, calibRAF, calibState, calibCountdown;
let pitchBuf, lastNoteMs = 0;

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

$('safari-warn').style.display = hasSetSinkId ? 'none' : 'block';

// The artist chain is fed by the calibration EQ (source -> calibrationEq -> engine).
// We never disconnect `source` here, so the analyser tap and calibration EQ stay live
// across preset switches.
function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  if (engine) {
    try { calibrationEq.output.disconnect(); } catch {}
    try { engine.output.disconnect(); } catch {}
  }
  engine = buildChain(ctx, preset.chain, registry);
  const AMP_TYPES = new Set(['drive', 'eq', 'cabinet']);
  const amp = [], ampIdx = [], ped = [], pedIdx = [];
  engine.modules.forEach((m, i) => {
    if (AMP_TYPES.has(m.type)) { amp.push(m); ampIdx.push(i); }
    else { ped.push(m); pedIdx.push(i); }
  });
  renderAmp($('amp'), amp, (j, k, v) => engine.setParam(ampIdx[j], k, v));
  renderPedalboard($('chain'), ped, (j, k, v) => engine.setParam(pedIdx[j], k, v));
  if (calibrationEq) calibrationEq.output.connect(engine.input);
  if (gainOut) engine.output.connect(gainOut);
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
  const ctx2d = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx2d.clearRect(0, 0, W, H);
  const N = 48;
  const bars = spectrumBars(freqBytes, N);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a45';
  ctx2d.fillStyle = accent;
  const bw = W / N;
  for (let i = 0; i < N; i++) {
    const h = Math.max(2, bars[i] * H);
    ctx2d.globalAlpha = 0.35 + 0.65 * bars[i];
    ctx2d.fillRect(i * bw + 1, H - h, bw - 2, h);
  }
  ctx2d.globalAlpha = 1;
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

    // Calibration EQ sits between source and the artist chain.
    calibrationEq = createCalibrationEq(ctx);
    source.connect(calibrationEq.input);
    applyActiveCalibration();

    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    loadPreset(defaultPreset);
    const sel = $('presets').querySelector('select');
    if (sel) sel.selectedIndex = PRESETS.indexOf(defaultPreset);

    renderCalibControls();
    startMeter();
    showStats();
    setTimeout(showStats, 600);

    $('start').disabled = true; $('stop').disabled = false;
    $('status').textContent = 'Live — play your guitar'; $('status-dot').classList.add('live');
    listDevices();
  } catch (e) {
    $('error').textContent = 'Could not start: ' + e.message;
    console.error(e);
  }
}

function stop() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  stopCalibration();
  $('meter').style.width = '0%';
  { const c = $('note-circle'); if (c) { c.textContent = '—'; c.classList.remove('active'); } }
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = analyser = calibrationEq = null;
  $('start').disabled = false; $('stop').disabled = true;
  $('status').textContent = 'Stopped'; $('status-dot').classList.remove('live');
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

$('gain').addEventListener('input', e => { if (gainOut) gainOut.gain.value = parseFloat(e.target.value); });
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSettings(false); });
$('diag').textContent = `${isSafari ? 'Safari' : 'Chrome'} · setSinkId: ${hasSetSinkId ? 'yes' : 'no'}`;

// Appearance: follow system, with a persisted manual override.
const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
function applyTheme() {
  const override = localStorage.getItem('ui-theme'); // 'light' | 'dark' | null
  document.documentElement.setAttribute('data-theme', resolveTheme(prefersDark(), override));
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!localStorage.getItem('ui-theme')) applyTheme();
});
$('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('ui-theme', next);
  applyTheme();
});

navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});
