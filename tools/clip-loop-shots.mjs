// tools/clip-loop-shots.mjs — live-app proof of GarageBand-style clip LOOP-DRAG.
//
// Powers the app on with a fake mic (same flags as tools/ui-shots.mjs), records
// a ~2s take, then drives the clip with real pointer gestures and asserts:
//   1. middle grab still MOVES the clip,
//   2. a bottom-right-edge grab still TRIMS it,
//   3. a TOP-right-edge grab loop-drags it to ~2.5 repetitions: width 2.5×,
//      boundary notches at every repetition edge, waveform canvas tiled,
//   4. extending near 3× snaps to exactly 3 repetitions,
//   5. playback runs the playhead across the full looped span (~3× the take).
// Writes shots/before/clip-loop.png (unlooped) + shots/after/clip-loop.png
// (looped 2.5×) and composites them into shots/compare/clip-loop.png.
//
// Usage: node tools/clip-loop-shots.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8913;
const URL = `http://localhost:${PORT}/?e2e=1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${PORT}/index.html`); if (r.status < 500) return proc; } catch {}
    await sleep(150);
  }
  proc.kill();
  throw new Error('dev server did not come up on port ' + PORT);
}

const clipState = (page) => page.evaluate(() => {
  const c = document.querySelector('.track-clip');
  if (!c) return null;
  const canvas = c.querySelector('canvas.clip-wave');
  return {
    left: parseFloat(c.style.left) || 0,
    width: parseFloat(c.style.width) || 0,
    canvasW: canvas ? canvas.width : 0,
    notches: [...c.querySelectorAll('.clip-loop-notch')].map((n) => parseFloat(n.style.left)),
  };
});

async function drag(page, x0, y0, dx) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + dx / 2, y0, { steps: 3 });
  await page.mouse.move(x0 + dx, y0, { steps: 3 });
  await page.mouse.up();
  await sleep(150);
}

async function run() {
  mkdirSync(join(ROOT, 'shots/before'), { recursive: true });
  mkdirSync(join(ROOT, 'shots/after'), { recursive: true });
  mkdirSync(join(ROOT, 'shots/compare'), { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    await sleep(600);

    // ── Record a ~2s take (tone fed through the chain for a visible waveform) ──
    await page.evaluate(() => window.__neuralE2E.feedTone(110, 0.3));
    await page.click('#tp-record');
    await sleep(2000);
    await page.click('#tp-record');
    await page.evaluate(() => window.__neuralE2E.stopTone());
    await page.waitForSelector('.track-clip', { timeout: 5000 });
    await sleep(200);

    const s0 = await clipState(page);
    const w0 = s0.width;                         // one repetition, px
    const lenSec = w0 / 32;                      // PX_PER_SEC = 32
    console.log(`Recorded take: width ${w0}px (~${lenSec.toFixed(2)}s)`);
    check('recorded clip exists', w0 > 40, `${w0}px`);

    const clip = page.locator('.track-clip').first();
    let box = await clip.boundingBox();

    // Shared framing for before/after: wide enough for the 2.5× loop.
    const frame = { x: Math.max(0, box.x - 10), y: box.y - 32, width: Math.ceil(w0 * 3.1) + 20, height: 130 };

    // ── 1. Middle grab still MOVES ──
    await drag(page, box.x + w0 / 2, box.y + 40, 64);
    let s = await clipState(page);
    check('middle grab moves the clip', Math.abs(s.left - (s0.left + 64)) <= 1 && Math.abs(s.width - w0) <= 1, `left ${s0.left}→${s.left}, width ${s.width}`);
    box = await clip.boundingBox();
    await drag(page, box.x + s.width / 2, box.y + 40, -64);   // put it back
    s = await clipState(page);
    check('moved back to origin', Math.abs(s.left - s0.left) <= 1, `left ${s.left}`);
    box = await clip.boundingBox();

    // ── 2. Bottom-right grab still TRIMS (lower 60% of the right edge) ──
    await drag(page, box.x + box.width - 2, box.y + 60, -24);
    s = await clipState(page);
    check('bottom-right grab trims len', Math.abs(s.width - (w0 - 24)) <= 3, `width ${w0}→${s.width}`);
    await page.keyboard.press('Control+z');                   // undo the trim
    await sleep(150);
    s = await clipState(page);
    check('undo restores the width', Math.abs(s.width - w0) <= 1, `width ${s.width}`);
    box = await clip.boundingBox();

    // ── BEFORE shot (unlooped) ──
    await page.screenshot({ path: join(ROOT, 'shots/before/clip-loop.png'), clip: frame });

    // ── 3. Top-right grab LOOP-DRAGS to ~2.5 repetitions ──
    await drag(page, box.x + box.width - 2, box.y + 8, Math.round(1.5 * w0));
    s = await clipState(page);
    check('loop drag → width ≈ 2.5×', Math.abs(s.width - 2.5 * w0) <= 4, `width ${s.width} vs ${2.5 * w0}`);
    check('two boundary notches at repetition edges',
      s.notches.length === 2 && Math.abs(s.notches[0] - w0) <= 2 && Math.abs(s.notches[1] - 2 * w0) <= 3,
      `notches [${s.notches}]`);
    check('canvas spans the looped clip', Math.abs(s.canvasW - s.width) <= 1, `canvas ${s.canvasW}`);
    const tiled = await page.evaluate(() => {
      const c = document.querySelector('.track-clip canvas.clip-wave');
      const ctx = c.getContext('2d');
      const baseW = parseFloat(document.querySelector('.clip-loop-notch').style.left);
      // Compare a vertical stripe of repetition 0 with the same stripe of repetition 1.
      const a = ctx.getImageData(8, 0, 24, c.height).data;
      const b = ctx.getImageData(8 + baseW, 0, 24, c.height).data;
      let same = 0, ink = 0;
      for (let i = 0; i < a.length; i += 4) { if (a[i + 3] === b[i + 3]) same++; if (a[i + 3] > 0) ink++; }
      return { frac: same / (a.length / 4), ink };
    });
    check('waveform is tiled (rep 1 pixels == rep 0 pixels)', tiled.frac > 0.99 && tiled.ink > 50, `match ${(tiled.frac * 100).toFixed(1)}%, ink ${tiled.ink}px`);

    // ── AFTER shot (looped 2.5×) ──
    await page.screenshot({ path: join(ROOT, 'shots/after/clip-loop.png'), clip: frame });

    // ── 4. Extending near 3× snaps to exactly 3 repetitions ──
    box = await clip.boundingBox();
    await drag(page, box.x + box.width - 2, box.y + 8, Math.round(0.5 * w0) - 3); // land ~3px shy of 3×
    s = await clipState(page);
    check('snaps to exactly 3 repetitions', Math.abs(s.width - 3 * w0) <= 2 && s.notches.length === 2, `width ${s.width} vs ${3 * w0}`);

    // ── 5. Playback runs the playhead across the full 3× span ──
    await page.click('#tp-start');
    const t0 = Date.now();
    await page.click('#tp-play');
    let maxLeft = 0, elapsed = 0;
    while (Date.now() - t0 < 15000) {
      const st = await page.evaluate(() => ({
        left: parseFloat(document.querySelector('.track-playhead').style.left) || 0,
        playing: document.querySelector('#tp-play').textContent.trim() !== '▶',
      }));
      maxLeft = Math.max(maxLeft, st.left);
      if (!st.playing && Date.now() - t0 > 500) { elapsed = (Date.now() - t0) / 1000; break; }
      await sleep(100);
    }
    const spanSec = 3 * lenSec;
    check('playhead sweeps ~3× the take', maxLeft > 2.6 * w0, `max ${maxLeft.toFixed(0)}px of ${3 * w0}px`);
    check('playback lasts ~3× the take', elapsed > spanSec - 0.5 && elapsed < spanSec + 1.2, `${elapsed.toFixed(2)}s vs ${spanSec.toFixed(2)}s`);

    // ── Composite before/after (tools/ui-compare.mjs pattern, this pair only) ──
    const html = `<!doctype html><html><head><style>
      body { margin: 0; background: #101216; font: 700 13px -apple-system, sans-serif; }
      .wrap { display: flex; gap: 14px; padding: 16px; align-items: flex-start; width: fit-content; }
      figure { margin: 0; } figcaption { color: #8b93a3; letter-spacing: .12em; margin-bottom: 8px; }
      figcaption.after { color: #f0b429; }
      img { display: block; max-width: 880px; height: auto; border-radius: 8px; border: 1px solid #2a2f3a; }
      h1 { color: #e7e9ee; font-size: 14px; margin: 14px 0 0 16px; letter-spacing: .06em; }
    </style></head><body><h1>clip-loop</h1><div class="wrap">
      <figure><figcaption>BEFORE</figcaption><img src="${pathToFileURL(join(ROOT, 'shots/before/clip-loop.png')).href}"></figure>
      <figure><figcaption class="after">AFTER — looped 2.5×</figcaption><img src="${pathToFileURL(join(ROOT, 'shots/after/clip-loop.png')).href}"></figure>
    </div></body></html>`;
    const tmp = join(ROOT, 'shots/compare/_clip-loop.html');
    await writeFile(tmp, html);
    const cpage = await context.newPage();
    await cpage.setViewportSize({ width: 1860, height: 700 });
    await cpage.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
    const b = await cpage.locator('.wrap').boundingBox();
    await cpage.screenshot({ path: join(ROOT, 'shots/compare/clip-loop.png'), clip: { x: 0, y: 0, width: Math.min(1860, b.x + b.width + 16), height: Math.min(700, b.y + b.height + 16) } });
    await cpage.close();
    await rm(tmp, { force: true });

    console.log(`\n${failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'} — shots/compare/clip-loop.png`);
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
  if (failures) process.exit(1);
}

run().catch((e) => { console.error('CLIP-LOOP ERROR:', e); process.exit(1); });
