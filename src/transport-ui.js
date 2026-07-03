// src/transport-ui.js
import { createMetronome, clampTempo } from './metronome.js';
import { createTuner } from './tuner.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

const TP = [
  ['tp-start', '⏮', 'Skip to start'],
  ['tp-play', '▶', 'Play'],
  ['tp-record', '⏺', 'Record'],
];

export function mountTransport(container, { getLiveAnalyser, onGain, onTempoChange }) {
  container.innerHTML = '';
  container.classList.add('transport-cluster');

  // ── Master VOL (output) with a live input-level meter under it ──
  const volg = el('div', 'io-vol');
  volg.append(el('span', 'io-vol-cap', 'VOL'));
  const stack = el('div', 'io-vol-stack');
  const gain = el('input'); gain.id = 'gain'; gain.type = 'range'; gain.min = '0'; gain.max = '2'; gain.step = '0.01'; gain.value = '1';
  gain.setAttribute('aria-label', 'Output volume');
  const meterBox = el('div', 'io-meter'); const meter = el('div', 'meter-fill'); meter.id = 'meter'; meterBox.appendChild(meter);
  stack.append(gain, meterBox);
  const gainVal = el('span', 'io-vol-val'); gainVal.id = 'gain-label'; gainVal.textContent = '1.0×';
  volg.append(stack, gainVal);
  gain.addEventListener('input', () => { const v = parseFloat(gain.value); gainVal.textContent = v.toFixed(1) + '×'; if (onGain) onGain(v); });

  // ── Transport (inert) ──
  const transport = el('div', 'transport');
  for (const [id, glyph, label] of TP) {
    const b = el('button', 'tp-btn' + (id === 'tp-record' ? ' tp-record' : ''));
    b.id = id; b.type = 'button'; b.disabled = true;
    b.title = `${label} — available with recording`;
    b.setAttribute('aria-label', label);
    b.textContent = glyph;
    transport.appendChild(b);
  }

  // ── Metronome ──
  const metro = el('div', 'metro');
  const metroBtn = el('button', 'metro-toggle'); metroBtn.id = 'metro-toggle'; metroBtn.type = 'button';
  metroBtn.title = 'Metronome'; metroBtn.setAttribute('aria-label', 'Metronome'); metroBtn.textContent = '♩';
  const bpm = el('span', 'metro-bpm'); bpm.id = 'metro-bpm';
  const bpmVal = el('span', 'metro-bpm-val'); bpmVal.textContent = '120';
  const bpmLbl = el('span', 'metro-bpm-lbl'); bpmLbl.textContent = 'BPM';
  bpm.append(bpmVal, bpmLbl);
  bpm.title = 'Drag or scroll to change · click to type';
  metro.append(metroBtn, bpm);

  const metronome = createMetronome({
    onBeat: (b) => { metroBtn.classList.add(b % 4 === 0 ? 'beat-accent' : 'beat'); setTimeout(() => metroBtn.classList.remove('beat', 'beat-accent'), 90); },
  });
  // Left-click ARMS the metronome (active colour): it clicks while recording.
  // Right-click opens a small menu to PLAY it for practice (free-run) without
  // recording — and if you hit record while it's running, the count-in continues
  // the same grid (1,2,3,4 in tempo) before recording starts.
  let metroArmed = false;
  let metroFree = false;
  metroBtn.title = 'Metronome — click to arm (clicks while recording) · right-click to practice';
  metroBtn.addEventListener('click', () => { metroArmed = !metroArmed; metroBtn.classList.toggle('on', metroArmed); });

  const setFree = (on) => {
    metroFree = on;
    metroBtn.classList.toggle('free', on);
    if (on) metronome.start(); else metronome.stop();
  };

  // ── Practice popover (right-click the metronome) ──
  let metroMenu = null;
  const onDocDown = (e) => { if (metroMenu && !metroMenu.contains(e.target) && e.target !== metroBtn) closeMetroMenu(); };
  function closeMetroMenu() { if (metroMenu) { metroMenu.remove(); metroMenu = null; document.removeEventListener('pointerdown', onDocDown, true); } }
  metroBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (metroMenu) { closeMetroMenu(); return; }
    const m = el('div', 'metro-menu');
    const item = el('button', 'metro-menu-item');
    item.type = 'button';
    item.textContent = metroFree ? '■  Stop metronome' : '▶  Play metronome (practice)';
    item.addEventListener('click', () => { setFree(!metroFree); closeMetroMenu(); });
    m.appendChild(item);
    document.body.appendChild(m);
    const r = metroBtn.getBoundingClientRect();
    m.style.left = `${Math.round(r.left)}px`;
    m.style.top = `${Math.round(r.bottom + 6)}px`;
    metroMenu = m;
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
  });

  // ── Count-in toggle (4 beats before recording) ──
  let countOn = false;
  const countWrap = el('div', 'countin');
  const countBtn = el('button', 'count-toggle'); countBtn.id = 'count-toggle'; countBtn.type = 'button';
  countBtn.title = 'Count-in — 4 beats before recording';
  countBtn.setAttribute('aria-label', 'Count-in before recording');
  countBtn.innerHTML = `<svg viewBox="0 0 26 12" width="20" height="12" aria-hidden="true">
    <circle cx="3" cy="6" r="2.3" fill="currentColor"/>
    <circle cx="10" cy="6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="17" cy="6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"/>
    <circle cx="24" cy="6" r="2.1" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  countBtn.addEventListener('click', () => { countOn = !countOn; countBtn.classList.toggle('on', countOn); });
  countWrap.append(countBtn);

  // BPM scrub (drag vertical / wheel) + click-to-type.
  const setBpm = (v) => { const n = clampTempo(v); metronome.setTempo(n); bpmVal.textContent = String(n); onTempoChange?.(n); };
  let dragY = 0, dragV = 0, dragging = false;
  bpm.addEventListener('pointerdown', (e) => { dragging = true; dragY = e.clientY; dragV = metronome.getTempo(); bpm.setPointerCapture(e.pointerId); e.preventDefault(); });
  bpm.addEventListener('pointermove', (e) => { if (!dragging) return; setBpm(dragV + Math.round((dragY - e.clientY) / 4)); });
  bpm.addEventListener('pointerup', () => { dragging = false; });
  bpm.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(metronome.getTempo() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  bpm.addEventListener('click', () => {
    if (dragging) return;
    const input = el('input', 'metro-bpm-input'); input.type = 'text'; input.inputMode = 'numeric'; input.value = String(metronome.getTempo());
    bpm.replaceWith(input); input.focus(); input.select();
    // Guard against a double commit: Enter commits AND blurs the input, and the
    // blur handler would commit again → replaceWith on an already-detached node
    // throws. Run exactly once.
    let done = false;
    const commit = (apply) => { if (done) return; done = true; if (apply) setBpm(parseInt(input.value, 10)); input.replaceWith(bpm); };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(true); else if (ev.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
  });

  // ── Tuner ──
  const tunerWrap = el('div', 'tuner');
  const tunerBtn = el('button', 'tuner-toggle'); tunerBtn.id = 'tuner-toggle'; tunerBtn.type = 'button';
  tunerBtn.title = 'Tuner'; tunerBtn.setAttribute('aria-label', 'Tuner'); tunerBtn.textContent = 'TUNER';
  const strip = el('div', 'tuner-strip'); strip.hidden = true;
  strip.innerHTML = `
    <span class="tuner-note">—</span>
    <span class="tuner-meter"><span class="tuner-ticks"></span><span class="tuner-needle"></span></span>
    <span class="tuner-readout"><span class="tuner-cents">--</span><span class="tuner-hz">— Hz</span></span>`;
  tunerWrap.append(tunerBtn, strip);
  const noteEl = strip.querySelector('.tuner-note');
  const needle = strip.querySelector('.tuner-needle');
  const centsEl = strip.querySelector('.tuner-cents');
  const hzEl = strip.querySelector('.tuner-hz');

  const tuner = createTuner({
    getLiveAnalyser,
    onReading: (r) => {
      if (!r) { noteEl.textContent = '—'; needle.style.left = '50%'; strip.classList.remove('in-tune'); centsEl.textContent = '--'; hzEl.textContent = '— Hz'; return; }
      noteEl.textContent = `${r.name}${r.octave}`;
      const pct = Math.max(0, Math.min(100, 50 + r.cents)); // −50..+50 → 0..100%
      needle.style.left = `${pct}%`;
      strip.classList.toggle('in-tune', Math.abs(r.cents) < 3);
      centsEl.textContent = `${r.cents >= 0 ? '+' : ''}${r.cents.toFixed(1)}¢`;
      hzEl.textContent = `${r.freq.toFixed(1)} Hz`;
    },
    onState: (s) => {
      tunerBtn.classList.toggle('on', s.on);
      strip.hidden = !s.on;
      // The tuner readout pops out to the right and would overlap the NOTE box —
      // hide NOTE while the tuner is open (it shows the note anyway).
      container.classList.toggle('tuner-open', s.on);
      if (s.error) { noteEl.textContent = s.error; }
    },
  });
  tunerBtn.addEventListener('click', () => { tuner.isOn() ? tuner.stop() : tuner.start(); });

  // ── Live note / pitch detector (updated by the main meter loop via #note-circle) ──
  const noteBox = el('div', 'tp-note'); noteBox.title = 'Detected note';
  const noteCircle = el('span', 'note-circle'); noteCircle.id = 'note-circle'; noteCircle.textContent = '—';
  noteBox.append(el('span', 'tp-note-cap', 'NOTE'), noteCircle);

  container.append(volg, transport, metro, countWrap, tunerWrap, noteBox);

  // Controller for the record flow (main.js): count-in + record-gated metronome
  // on ONE continuous beat grid (no seam between count-in and the first beat).
  return {
    getTempo: () => metronome.getTempo(),
    isCountIn: () => countOn,
    isMetroArmed: () => metroArmed,
    isMetroFree: () => metroFree,
    // A record needs the metronome grid if counting in, armed, or practising.
    needsSession: () => countOn || metroArmed || metroFree,
    // Practice (free-run) → always count 4 in (continuing the running grid) and
    // keep clicking through the take. Otherwise count-in only if its toggle is on.
    recordSession: (onDownbeat) => metronome.armRecord({
      countBeats: (metroFree || countOn) ? 4 : 0,
      recordMetro: metroFree || metroArmed,
      onDownbeat,
    }),
    // End the take; if we were practising, resume the free-run click afterwards.
    endSession: () => { metronome.stop(); if (metroFree) metronome.start(); },
  };
}
