// src/chain-ui/pedalboard.js
import { createKnob } from './knob.js';

const HUES = { compressor: 205, drive: 20, eq: 280, cabinet: 140, delay: 48, reverb: 320, chorus: 175 };

export function renderPedalboard(container, modules, onParamChange) {
  container.innerHTML = '';
  const board = document.createElement('div');
  board.className = 'pedalboard';

  modules.forEach((m, i) => {
    if (i > 0) {
      const conn = document.createElement('div');
      conn.className = 'connector'; conn.textContent = '→'; conn.setAttribute('aria-hidden', 'true');
      board.appendChild(conn);
    }
    const pedal = document.createElement('div');
    pedal.className = 'pedal';
    pedal.style.setProperty('--pedal-hue', String(HUES[m.type] ?? 30));

    const plate = document.createElement('div');
    plate.className = 'pedal-name'; plate.textContent = m.schema.label;

    const knobs = document.createElement('div');
    knobs.className = 'knobs';
    for (const p of m.schema.params) {
      const { el } = createKnob(p, m.params[p.key] ?? p.default, (v) => onParamChange(i, p.key, v));
      knobs.appendChild(el);
    }
    const foot = document.createElement('div');
    foot.className = 'pedal-foot';
    const led = document.createElement('div');
    led.className = 'pedal-led';
    foot.appendChild(led);
    pedal.append(plate, knobs, foot);
    board.appendChild(pedal);
  });

  container.appendChild(board);
}
