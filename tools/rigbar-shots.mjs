// tools/rigbar-shots.mjs — prove the rig-bar batch behaves (same server +
// fake-audio pattern as tools/viz-shots.mjs).
//
//   1. both-expanded.png     — amp head + full pedalboard stacked normally.
//   2. docked.png            — BOTH collapsed → the two strips dock side by
//                              side into one slim row (body.rig-docked);
//                              expanding either panel un-docks (asserted).
//   3. compressor-parked.png / compressor-tuning.png — the punched-up
//      compressor screen: parked still vs mid-tuning frame. Mean pixel diff
//      must be ≥ 1.5 (the pump + GR needle kick, not a subtle drift).
//   4. live auto-fold check  — record start folds amp+board, stop restores.
//   5. power-on ritual check — #amp.power-warmup appears once after start().
//
// Usage:  node tools/rigbar-shots.mjs          → writes shots/rigbar/*.png
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8914;
const URL = `http://localhost:${PORT}/?e2e=1`;
const OUT = join(ROOT, process.argv[2] || 'shots/rigbar');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};

async function startServer() {
  const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try { const r = await fetch(`http://localhost:${PORT}/index.html`); if (r.status < 500) return proc; } catch {}
    await sleep(150);
  }
  proc.kill();
  throw new Error('dev server did not come up on port ' + PORT);
}

// Screenshot the union of the amp strip + pedalboard strip sections.
async function shootRig(page, file) {
  const a = await page.locator('.amp-strip').boundingBox();
  const b = await page.locator('.pedalboard-strip').boundingBox();
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const clip = {
    x, y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
  const path = join(OUT, file);
  await page.screenshot({ path, clip });
  const ok = existsSync(path) && statSync(path).size > 1000;
  console.log(`  ${ok ? 'OK  ' : 'THIN'} ${file} (${clip.width.toFixed(0)}x${clip.height.toFixed(0)} css px)`);
  return clip;
}

async function shootPlate(page, word, file) {
  const plate = page.locator('.pedal').filter({ hasText: word }).first().locator('.pedal-plate');
  await plate.waitFor({ state: 'visible', timeout: 8000 });
  await plate.scrollIntoViewIfNeeded();
  const path = join(OUT, file);
  await plate.screenshot({ path, animations: 'allow' });
  console.log(`  OK   ${file} (${statSync(path).size} bytes)`);
  return path;
}

// Mean absolute per-channel pixel difference between two PNGs (0..255).
async function meanDiff(page, fileA, fileB) {
  const b64 = (f) => readFileSync(f).toString('base64');
  return page.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = rej;
      img.src = 'data:image/png;base64,' + s;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, w, h).data;
    g.clearRect(0, 0, w, h);
    g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < da.length; i += 4) {
      sum += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return sum / (da.length / 4) / 3;
  }, [b64(fileA), b64(fileB)]);
}

const bodyDocked = (page) => page.evaluate(() => document.body.classList.contains('rig-docked'));
const collapsedStates = (page) => page.evaluate(() => ({
  amp: !!document.querySelector('.amp-wrap.collapsed'),
  board: !!document.querySelector('.board-wrap.collapsed'),
}));

async function expandBoth(page) {
  if (await page.locator('.amp-wrap.collapsed').count()) { await page.locator('.amp-vstrip').click(); await sleep(150); }
  if (await page.locator('.board-wrap.collapsed').count()) { await page.locator('.board-strip').click(); await sleep(150); }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1400 }, // tall: amp + board fully visible
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference', // the ritual + viz freeze under reduce
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'load' });

    // ── Power on + one-shot ritual ──
    const ritual = page.waitForSelector('#amp.power-warmup', { timeout: 15000 }).then(() => true).catch(() => false);
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    check(await ritual, 'power-on ritual ran once (#amp.power-warmup observed after start())');
    await page.waitForSelector('#amp.power-warmup', { state: 'detached', timeout: 4000 }).catch(() => {});
    check(!(await page.locator('#amp.power-warmup').count()), 'ritual settled (classes removed within budget)');
    await sleep(400);

    // ── Unified affordance sanity (live DOM) ──
    const aff = await page.evaluate(() => ({
      pb: !!document.querySelector('.pb-collapse.collapse-chev[aria-expanded]'),
      amp: !!document.querySelector('.amp-collapse-btn.collapse-chev[aria-expanded="true"]'),
      board: !!document.querySelector('.board-collapse-btn.collapse-chev[aria-expanded="true"]'),
    }));
    check(aff.pb && aff.amp && aff.board, 'all three collapse controls share .collapse-chev + aria-expanded');

    // ── 1. both expanded ──
    await expandBoth(page);
    check(!(await bodyDocked(page)), 'not docked while expanded');
    await shootRig(page, 'both-expanded.png');

    // ── 2. docked rig bar ──
    await page.locator('.amp-collapse-btn').click(); await sleep(150);
    await page.locator('.board-collapse-btn').click(); await sleep(250);
    check(await bodyDocked(page), 'both collapsed → body.rig-docked');
    const clip = await shootRig(page, 'docked.png');
    check(clip.height <= 100, `docked row is slim (${clip.height.toFixed(0)}px ≤ 100px)`);
    // expanding either panel un-docks
    await page.locator('.amp-vstrip').click(); await sleep(150);
    check(!(await bodyDocked(page)), 'expanding the amp un-docks');
    await page.locator('.amp-collapse-btn').click(); await sleep(150);
    check(await bodyDocked(page), 're-collapsing re-docks');

    // ── 3. auto-fold on transport (record start/stop) ──
    await expandBoth(page);
    await page.click('#tp-record');
    await page.waitForSelector('#tp-record.recording', { timeout: 12000 }); // count-in may delay the start
    await sleep(200);
    const folded = await collapsedStates(page);
    check(folded.amp && folded.board && (await bodyDocked(page)), 'record start auto-folds amp + board into the rig bar');
    await page.click('#tp-record'); // stop
    await sleep(300);
    const restored = await collapsedStates(page);
    check(!restored.amp && !restored.board && !(await bodyDocked(page)), 'record stop restores the pre-transport state (both expanded)');

    // ── 4. compressor parked vs tuning ──
    await page.evaluate(() => window.__neuralE2E.addPedalBefore('compressor'));
    await sleep(250);
    await page.evaluate(() => window.__neuralE2E.setPedalParam('compressor', 'threshold', -26));
    await page.evaluate(() => window.__neuralE2E.setPedalParam('compressor', 'ratio', 8));
    await sleep(4500); // ease-out fully → parked
    // One kick, several mid-animation samples: the pump sweeps its full range
    // during the ~1.4s animation window, so the sample farthest from the
    // parked pose is the honest "while tuning" frame.
    let best = 0;
    for (let attempt = 0; attempt < 2 && best < 1.5; attempt++) {
      // kick with a 1dB nudge (pose barely moves; the PUMP is what differs)
      await page.evaluate((v) => window.__neuralE2E.setPedalParam('compressor', 'threshold', v), -27 - attempt);
      const candidates = [];
      for (let s = 0; s < 5; s++) {
        await sleep(120);
        candidates.push(await shootPlate(page, 'COMPRESSOR', `compressor-tuning-${s}.png`));
      }
      await sleep(4500); // park at the same params
      await shootPlate(page, 'COMPRESSOR', 'compressor-parked.png');
      let bestFile = null;
      for (const f of candidates) {
        const d = await meanDiff(page, join(OUT, 'compressor-parked.png'), f);
        console.log(`  diff ${d.toFixed(2)}  parked vs ${f.split('/').pop()}`);
        if (d > best) { best = d; bestFile = f; }
      }
      if (bestFile) copyFileSync(bestFile, join(OUT, 'compressor-tuning.png'));
      for (const f of candidates) rmSync(f, { force: true });
    }
    check(best >= 1.5, `compressor parked vs tuning clearly differ (best diff ${best.toFixed(2)} ≥ 1.5)`);
    // stillness: parked frame stays byte-stable
    await sleep(1000);
    await shootPlate(page, 'COMPRESSOR', 'compressor-parked2.png');
    const dStill = await meanDiff(page, join(OUT, 'compressor-parked.png'), join(OUT, 'compressor-parked2.png'));
    check(dStill < 0.4, `compressor is STILL at rest (diff ${dStill.toFixed(2)} < 0.4)`);

    console.log(`\nShots written to ${OUT}/`);
    if (failures) { console.error(`${failures} rig-bar check(s) failed`); process.exitCode = 1; }
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
}

run().catch((e) => { console.error('RIGBAR SHOTS ERROR:', e); process.exit(1); });
