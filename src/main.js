// src/main.js
import { registry } from './effects/index.js';
import { buildChain } from './engine.js';
import { PRESETS, validatePreset } from './presets.js';
import { renderChain, renderPresetPicker } from './ui.js';

const $ = id => document.getElementById(id);
let ctx, stream, source, engine, gainOut;

const isSafari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent);
const hasSetSinkId = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

function loadPreset(preset) {
  const errors = validatePreset(preset, registry);
  if (errors.length) { $('error').textContent = errors.join('; '); return; }
  if (engine) { try { source.disconnect(); } catch {} }
  engine = buildChain(ctx, preset.chain, registry);
  source.connect(engine.input);
  engine.output.connect(gainOut);
  renderChain($('chain'), engine.modules, (i, k, v) => engine.setParam(i, k, v));
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
    const outId = $('output').value;
    if (outId && outId !== 'default' && hasSetSinkId) { try { await ctx.setSinkId(outId); } catch {} }
    source = ctx.createMediaStreamSource(stream);
    gainOut = ctx.createGain();
    gainOut.gain.value = parseFloat($('gain').value);
    gainOut.connect(ctx.destination);
    renderPresetPicker($('presets'), PRESETS, loadPreset);
    loadPreset(PRESETS.find(p => p.name.includes('Edge of Breakup')) || PRESETS[0]);
    $('start').disabled = true; $('stop').disabled = false;
    $('status').textContent = 'Live — play your guitar'; $('status-dot').classList.add('live');
    listDevices();
  } catch (e) {
    $('error').textContent = 'Could not start: ' + e.message;
    console.error(e);
  }
}

function stop() {
  if (stream) stream.getTracks().forEach(t => t.stop());
  if (ctx) ctx.close();
  ctx = stream = source = engine = gainOut = null;
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
