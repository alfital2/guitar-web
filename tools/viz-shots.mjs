// tools/viz-shots.mjs — prove the tune-to-animate pedal screens behave.
//
// Boots the app (same server + fake-audio flags as tools/ui-shots.mjs), adds a
// delay, a distortion and a compressor pedal, then per pedal proves three
// things via the __neuralE2E.setPedalParam bridge and mean-pixel diffs:
//   1. params a→b changes the settled frame structurally (echo spacing
//      spreads, clip shape squares, knee bends),
//   2. at rest the screen is STILL (two shots 1s apart are identical),
//   3. right after a knob move the screen is animating (differs from settled).
// Also folds the pedalboard to its mini strip and screenshots it.
//
// Usage:  node tools/viz-shots.mjs            → writes shots/viz/*.png
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8913;
const URL = `http://localhost:${PORT}/?e2e=1`;
const OUT = join(ROOT, process.argv[2] || 'shots/viz');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Screenshot the .pedal-plate (the viz screen) of the pedal whose nameplate
// reads `word`.
async function shootPlate(page, word, file) {
  const plate = page.locator('.pedal').filter({ hasText: word }).first().locator('.pedal-plate');
  await plate.waitFor({ state: 'visible', timeout: 8000 });
  await plate.scrollIntoViewIfNeeded();
  const path = join(OUT, file);
  await plate.screenshot({ path, animations: 'allow' });
  const ok = existsSync(path) && statSync(path).size > 1000;
  console.log(`  ${ok ? 'OK  ' : 'THIN'} ${file} (${existsSync(path) ? statSync(path).size : 0} bytes)`);
  return path;
}

// Mean absolute pixel difference between two same-sized PNGs, computed inside
// the browser (canvas) so the tool needs no image dependency. 0 = identical.
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
    return sum / (da.length / 4) / 3; // mean per-channel abs diff, 0..255
  }, [b64(fileA), b64(fileB)]);
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
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference', // the viz freezes under reduce — force live
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  let failures = 0;
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    await sleep(800);

    for (const type of ['delay', 'distortion', 'compressor']) {
      await page.evaluate((t) => window.__neuralE2E.addPedalBefore(t), type);
      await sleep(250);
    }

    // Tune-to-animate timing: a param change kicks the animation, which runs
    // ~0.6s at full speed then eases out and parks (~3.5s total). SETTLE waits
    // for the parked, param-true still; TUNING samples mid-animation.
    const SETTLE = 4500, TUNING = 250;

    // [type, nameplate word, [key, valueA, valueB][], what should change]
    const cases = [
      ['delay', 'DELAY', [['time', 150, 850], ['feedback', 0.7, 0.7]], 'echo bar spacing spreads'],
      ['distortion', 'DISTORTION', [['dist', 0, 10]], 'clean sine squares into the rails'],
      ['compressor', 'COMPRESSOR', [['threshold', -6, -50], ['ratio', 1.2, 20]], 'knee bends down hard'],
    ];

    const setAll = (type, sets, which) => Promise.all(sets.map(([key, va, vb]) =>
      page.evaluate(([t, k, v]) => window.__neuralE2E.setPedalParam(t, k, v),
        [type, key, which === 'a' ? va : vb])));

    for (const [type, word, sets, expectWhat] of cases) {
      await setAll(type, sets, 'a');
      await sleep(SETTLE);
      await shootPlate(page, word, `${type}-a.png`);
      // stillness proof: same params 1s later → identical frame (no idle anim)
      await sleep(1000);
      await shootPlate(page, word, `${type}-a2.png`);
      await setAll(type, sets, 'b');
      await sleep(TUNING); // mid-animation (the knob just moved)
      await shootPlate(page, word, `${type}-tuning.png`);
      await sleep(SETTLE);
      await shootPlate(page, word, `${type}-b.png`);

      const dAB = await meanDiff(page, join(OUT, `${type}-a.png`), join(OUT, `${type}-b.png`));
      const dStill = await meanDiff(page, join(OUT, `${type}-a.png`), join(OUT, `${type}-a2.png`));
      const dTune = await meanDiff(page, join(OUT, `${type}-tuning.png`), join(OUT, `${type}-b.png`));
      const okAB = dAB > 1.0, okStill = dStill < 0.4, okTune = dTune > 0.3;
      if (!okAB || !okStill) failures++;
      console.log(`  ${okAB ? 'DIFF' : 'SAME'} ${type}: params a→b diff ${dAB.toFixed(2)} (${expectWhat})`);
      console.log(`  ${okStill ? 'STILL' : 'MOVING'} ${type}: at-rest diff ${dStill.toFixed(2)} (must be ~0 — no idle animation)`);
      console.log(`  ${okTune ? 'ANIM ' : 'FLAT '} ${type}: tuning vs settled diff ${dTune.toFixed(2)} (animation while tuning)`);
    }

    // Collapsed-board strip: fold the chain to the mini strip and shoot it.
    await page.locator('.board-collapse-btn').click();
    await sleep(400);
    const strip = page.locator('.board-strip');
    await strip.waitFor({ state: 'visible', timeout: 5000 });
    await strip.screenshot({ path: join(OUT, 'board-strip.png') });
    console.log('  OK   board-strip.png (collapsed pedalboard)');
    await strip.click(); // expand back
    await sleep(300);

    console.log(`\nShots written to ${OUT}/`);
    if (failures) { console.error(`${failures} viz check(s) failed`); process.exitCode = 1; }
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
}

run().catch((e) => { console.error('VIZ SHOTS ERROR:', e); process.exit(1); });
