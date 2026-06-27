// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset } from './presets.js';
import { renderChain, renderPresetPicker } from './ui.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut, analyser, rafId;

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

// FIX 4: Show/hide safari-warn on load based on setSinkId support
$('safari-warn').style.display = hasSetSinkId ? 'none' : 'block';

function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  // FIX 4: Also disconnect engine.output before rebuilding to avoid stale node connections
  if (engine) {
    try { source.disconnect(); } catch {}
    try { engine.output.disconnect(); } catch {}
  }
  engine = buildChain(ctx, preset.chain, registry);
  source.connect(engine.input);
  engine.output.connect(gainOut);
  renderChain($('chain'), engine.modules, (i, k, v) => engine.setParam(i, k, v));
}

// FIX 2: Populate latency stat boxes
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

// FIX 1: rAF loop that reads analyser and drives the meter
function startMeter() {
  const buf = new Uint8Array(analyser.fftSize);
  function loop() {
    rafId = requestAnimationFrame(loop);
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i] - 128);
      if (v > peak) peak = v;
    }
    $('meter').style.width = Math.min(100, peak / 128 * 100 * 1.5) + '%';
  }
  loop();
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

    // FIX 2: Set sample rate immediately; outputLatency may not have settled yet
    $('sr').textContent = ctx.sampleRate + ' Hz';

    const outId = $('output').value;
    if (outId && outId !== 'default' && hasSetSinkId) { try { await ctx.setSinkId(outId); } catch {} }
    source = ctx.createMediaStreamSource(stream);

    // FIX 1: Create analyser as a tap off source (NOT in the effects path)
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    gainOut = ctx.createGain();
    gainOut.gain.value = parseFloat($('gain').value);
    gainOut.connect(ctx.destination);

    // FIX 3: Find default preset, render picker, load preset, then sync dropdown selection
    const defaultPreset = PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0];
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    loadPreset(defaultPreset);
    const sel = $('presets').querySelector('select');
    if (sel) sel.selectedIndex = PRESETS.indexOf(defaultPreset);

    // FIX 1: Start meter loop
    startMeter();

    // FIX 2: Show stats now, and again after ~600ms so outputLatency can settle
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
  // FIX 1: Cancel the rAF meter loop
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  $('meter').style.width = '0%';
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = analyser = null;
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
$('diag').textContent = `${isSafari ? 'Safari' : 'Chrome'} · setSinkId: ${hasSetSinkId ? 'yes' : 'no'}`;
navigator.mediaDevices.enumerateDevices().then(listDevices).catch(() => {});
