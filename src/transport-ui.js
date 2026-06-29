// src/transport-ui.js
import { createMetronome, clampTempo } from './metronome.js';
import { createTuner } from './tuner.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// Inert transport buttons — ground for the coming recording feature.
const TP = [
  ['tp-rewind', '⏪', 'Rewind'],
  ['tp-ffwd', '⏩', 'Fast-forward'],
  ['tp-start', '⏮', 'Skip to start'],
  ['tp-play', '▶', 'Play'],
  ['tp-record', '⏺', 'Record'],
];

export function mountTransport(container, { getLiveAnalyser }) {
  container.innerHTML = '';
  container.classList.add('transport-cluster');

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
  metroBtn.addEventListener('click', () => { metronome.toggle(); metroBtn.classList.toggle('on', metronome.isRunning()); });

  // BPM scrub (drag vertical / wheel) + click-to-type.
  const setBpm = (v) => { const n = clampTempo(v); metronome.setTempo(n); bpmVal.textContent = String(n); };
  let dragY = 0, dragV = 0, dragging = false;
  bpm.addEventListener('pointerdown', (e) => { dragging = true; dragY = e.clientY; dragV = metronome.getTempo(); bpm.setPointerCapture(e.pointerId); e.preventDefault(); });
  bpm.addEventListener('pointermove', (e) => { if (!dragging) return; setBpm(dragV + Math.round((dragY - e.clientY) / 4)); });
  bpm.addEventListener('pointerup', () => { dragging = false; });
  bpm.addEventListener('wheel', (e) => { e.preventDefault(); setBpm(metronome.getTempo() + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  bpm.addEventListener('click', () => {
    if (dragging) return;
    const input = el('input', 'metro-bpm-input'); input.type = 'text'; input.inputMode = 'numeric'; input.value = String(metronome.getTempo());
    bpm.replaceWith(input); input.focus(); input.select();
    const commit = (apply) => { if (apply) setBpm(parseInt(input.value, 10)); input.replaceWith(bpm); };
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
      if (s.error) { noteEl.textContent = s.error; }
    },
  });
  tunerBtn.addEventListener('click', () => { tuner.isOn() ? tuner.stop() : tuner.start(); });

  container.append(transport, metro, tunerWrap);
}
