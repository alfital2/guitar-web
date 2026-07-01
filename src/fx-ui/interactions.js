// Micro-interactions — vanilla ports of react-bits concepts (MIT + Commons
// Clause; see assets/LICENSE-react-bits.md), tuned to the studio.
//
//   • GlareHover  — a specular highlight tracks the pointer across each pedal's
//                   metal face. Hover-only; no animation frame, just a CSS var.
//   • ClickSpark  — an amber spark burst on meaningful clicks (power, record,
//                   footswitches…). A single transient canvas; the loop runs
//                   only while sparks are alive, then stops.
//
// Both respect prefers-reduced-motion and are pointer-events:none, so they
// never interfere with the controls or the audio path.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function accentRgb() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  return v || '240,180,41';
}

// ── ClickSpark: amber burst at the click point ─────────────────────────────
const SPARK_SELECTOR = '#power, #tp-record, .pedal-power, .btn-start, .tp-btn, #settings-toggle';

function initSparks() {
  const canvas = document.createElement('canvas');
  canvas.className = 'spark-fx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  let dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  let sparks = [];       // { x, y, born }
  let rafId = 0;
  const DURATION = 420;  // ms
  const COUNT = 11;
  const RADIUS = 26;     // px reach
  const LEN = 11;        // line length

  function frame(now) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rgb = accentRgb();
    sparks = sparks.filter(s => now - s.born < DURATION);
    for (const s of sparks) {
      const p = (now - s.born) / DURATION;          // 0..1
      const ease = 1 - Math.pow(1 - p, 3);          // easeOutCubic
      const alpha = 1 - p;
      for (let i = 0; i < COUNT; i++) {
        const a = (i / COUNT) * Math.PI * 2;
        const dist = ease * RADIUS;
        const x1 = (s.x + Math.cos(a) * dist) * dpr;
        const y1 = (s.y + Math.sin(a) * dist) * dpr;
        const x2 = (s.x + Math.cos(a) * (dist + LEN)) * dpr;
        const y2 = (s.y + Math.sin(a) * (dist + LEN)) * dpr;
        ctx.strokeStyle = `rgba(${rgb},${alpha})`;
        ctx.lineWidth = 2 * dpr;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    if (sparks.length) {
      rafId = requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      rafId = 0;                                    // idle — stop burning frames
    }
  }

  function spawn(x, y) {
    sparks.push({ x, y, born: performance.now() });
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  document.addEventListener('click', e => {
    if (reduceMotion()) return;
    const hit = e.target instanceof Element ? e.target.closest(SPARK_SELECTOR) : null;
    if (!hit) return;
    spawn(e.clientX, e.clientY);
  });
}

export function initInteractions() {
  initSparks();
}

initInteractions();
