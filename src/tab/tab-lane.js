// src/tab/tab-lane.js — the live TAB lane above the amp: a scrolling 6-line
// tablature grid, one column per 16th note, bar lines every 16 columns (4/4),
// an amber cursor riding the metronome grid, and fret numbers landing in real
// time as the transcriber emits notes. Rendering is plain DOM (positioned
// spans over 6 CSS lines) — cheap, no canvas needed at this density.

const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E'];
const COL_W = 26;         // px per 16th column
const LINE_GAP = 15;      // px between string lines

export function mountTabLane(container, { bpm = 120 } = {}) {
  container.innerHTML = '';
  container.hidden = false;

  const head = document.createElement('div');
  head.className = 'tab-head';
  head.innerHTML = `
    <span class="tab-title">TAB <i class="tab-live-dot"></i> live transcription</span>
    <span class="tab-meta">${bpm} BPM · 16th grid · standard tuning</span>
    <span class="tab-spacer"></span>
    <button type="button" class="tab-clear">Clear</button>
    <button type="button" class="tab-close" aria-label="Close tab lane">✕</button>`;

  const scroll = document.createElement('div');
  scroll.className = 'tab-scroll';
  const stage = document.createElement('div');
  stage.className = 'tab-stage';
  scroll.appendChild(stage);

  // String name gutter + the 6 lines.
  const gutter = document.createElement('div');
  gutter.className = 'tab-gutter';
  gutter.innerHTML = STRING_NAMES.map((n, i) => `<i style="top:${i * LINE_GAP}px">${n}</i>`).join('');
  const lines = document.createElement('div');
  lines.className = 'tab-lines';
  lines.innerHTML = STRING_NAMES.map((_, i) => `<i style="top:${i * LINE_GAP}px"></i>`).join('');
  stage.appendChild(lines);

  const cursor = document.createElement('div');
  cursor.className = 'tab-cursor';
  stage.appendChild(cursor);

  container.append(head, gutter, scroll);

  let cols = 0, notes = 0;
  const ensureCols = (col) => {
    if (col + 4 <= cols) return;
    const target = col + 16;
    for (let c = cols; c < target; c++) {
      if (c > 0 && c % 16 === 0) {
        const bar = document.createElement('i');
        bar.className = 'tab-bar';
        bar.style.left = `${c * COL_W}px`;
        stage.appendChild(bar);
        const num = document.createElement('span');
        num.className = 'tab-barnum';
        num.textContent = String(c / 16 + 1);
        num.style.left = `${c * COL_W + 3}px`;
        stage.appendChild(num);
      }
    }
    cols = target;
    stage.style.width = `${cols * COL_W + 40}px`;
  };
  ensureCols(16);

  const api = {
    // Place a fret number: string 0 (top, high e) … 5, at a 16th column.
    noteOn(string, fret, col) {
      ensureCols(col);
      const n = document.createElement('span');
      n.className = 'tab-note';
      n.textContent = String(fret);
      n.style.left = `${col * COL_W + COL_W / 2}px`;
      n.style.top = `${string * LINE_GAP}px`;
      stage.appendChild(n);
      notes++;
      requestAnimationFrame(() => n.classList.add('in'));
      // keep the action in view
      scroll.scrollLeft = Math.max(0, (col + 3) * COL_W - scroll.clientWidth);
      return n;
    },
    setCursor(beatFloat) {
      const x = beatFloat * 4 * COL_W; // beats → 16th cols
      ensureCols(Math.ceil(beatFloat * 4));
      cursor.style.transform = `translateX(${x}px)`;
    },
    setBpm(v) { const m = head.querySelector('.tab-meta'); if (m) m.textContent = `${v} BPM · 16th grid · standard tuning`; },
    clear() {
      stage.querySelectorAll('.tab-note, .tab-bar, .tab-barnum').forEach((n) => n.remove());
      cols = 0; notes = 0; ensureCols(16); scroll.scrollLeft = 0;
    },
    noteCount: () => notes,
    onClear(cb) { head.querySelector('.tab-clear').addEventListener('click', cb); },
    onClose(cb) { head.querySelector('.tab-close').addEventListener('click', cb); },
    destroy() { container.innerHTML = ''; container.hidden = true; },
  };
  return api;
}
