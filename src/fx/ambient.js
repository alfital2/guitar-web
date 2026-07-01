// Ambient — the original lightweight drifting-blob canvas (no WebGL). Cheapest
// option; also the reduced-motion / low-power fallback. Renders a tiny buffer
// upscaled + blurred via CSS.
import { rafLoop } from './_loop.js';

const MAX_W = 200;
const COOL = '90,110,150';
const WARM = '120,70,30';
const BLOBS = [
  { tone: 'accent', x: 0.28, y: 0.20, r: 0.52, a: 0.14, amp: 0.05, speed: 0.13, phase: 0.0 },
  { tone: 'accent', x: 0.80, y: 0.74, r: 0.48, a: 0.09, amp: 0.06, speed: 0.09, phase: 2.1 },
  { tone: 'cool',   x: 0.64, y: 0.16, r: 0.62, a: 0.16, amp: 0.07, speed: 0.07, phase: 4.0 },
  { tone: 'cool',   x: 0.16, y: 0.82, r: 0.54, a: 0.14, amp: 0.05, speed: 0.11, phase: 1.0 },
  { tone: 'warm',   x: 0.50, y: 0.52, r: 0.70, a: 0.03, amp: 0.04, speed: 0.05, phase: 3.3 }
];

export function createAmbient(container, opts = {}) {
  const { accentRgb = '240,180,41', reduceMotion = false } = opts;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;filter:blur(42px) saturate(1.2);';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  let w = 0, h = 0;
  function rgb(tone) { return tone === 'cool' ? COOL : tone === 'warm' ? WARM : accentRgb; }
  function resize() {
    const ratio = window.innerHeight / Math.max(1, window.innerWidth);
    w = MAX_W; h = Math.max(1, Math.round(MAX_W * ratio));
    canvas.width = w; canvas.height = h;
  }
  function draw(tSec) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of BLOBS) {
      const cx = (b.x + Math.sin(tSec * b.speed + b.phase) * b.amp) * w;
      const cy = (b.y + Math.cos(tSec * b.speed * 0.8 + b.phase) * b.amp) * h;
      const rad = b.r * w;
      const col = rgb(b.tone);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(${col},${b.a})`);
      g.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    const vg = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
  }

  resize();
  window.addEventListener('resize', resize);

  let stop = () => {};
  if (reduceMotion) {
    draw(0);
  } else {
    stop = rafLoop(t => draw(t / 1000), { fps: 24 });
  }

  return {
    destroy() {
      stop();
      window.removeEventListener('resize', resize);
      canvas.remove();
    }
  };
}
