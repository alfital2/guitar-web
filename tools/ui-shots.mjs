// tools/ui-shots.mjs — capture CLIPPED element screenshots of the app's UI
// devices for the top-tier UI pass before/after comparison.
//
// Serves the repo with `python3 -m http.server`, opens the app with ?e2e (so the
// window.__neuralE2E bridge is available), powers on (a real user gesture), loads
// specific presets, and screenshots individual elements at 2x deviceScaleFactor.
//
// Usage:  node tools/ui-shots.mjs shots/before
//         node tools/ui-shots.mjs shots/after
//
// Modeled on tests/neural-e2e.mjs (same server + fake-audio launch flags).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8912;
const URL = `http://localhost:${PORT}/?e2e=1`;

const outDir = process.argv[2] || 'shots/before';
const OUT = join(ROOT, outDir);

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

// Load a preset by name and (if the amp folded to its value strip) expand it so
// the full amp head is visible for the screenshot.
async function loadAndExpand(page, name, settleMs) {
  await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), name);
  await sleep(settleMs);
  const collapsed = await page.locator('.amp-wrap.collapsed').count();
  if (collapsed) {
    await page.locator('.amp-vstrip').click();
    await sleep(300);
  }
}

async function shoot(page, selector, file, pad = 0) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8000 });
  await loc.scrollIntoViewIfNeeded();
  await sleep(150);
  const path = join(OUT, file);
  if (pad) {
    const box = await loc.boundingBox();
    await page.screenshot({
      path,
      clip: {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
        width: box.width + pad * 2, height: box.height + pad * 2,
      },
    });
  } else {
    await loc.screenshot({ path });
  }
  const ok = existsSync(path) && statSync(path).size > 1000;
  console.log(`  ${ok ? 'OK  ' : 'THIN'} ${file} (${existsSync(path) ? statSync(path).size : 0} bytes)`);
  return ok;
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
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    await sleep(800); // fonts + first render

    // 1) Analytic amp head with the first Clean Guitar preset.
    await loadAndExpand(page, 'Amazing Tweed', 1200);
    await shoot(page, '.amp-head', 'amp-analytic.png', 20);

    // 2) Neural faceplates — three Professional amps.
    for (const [name, file] of [
      ['Marshall JCM', 'amp-neural-jcm.png'],
      ['Fender Deluxe', 'amp-neural-deluxe.png'],
      ['Vox AC10', 'amp-neural-ac10.png'],
    ]) {
      await loadAndExpand(page, name, 4200); // let the neural model come up
      await shoot(page, '.amp-head', file, 20);
    }

    // 3) Pedal close-up + whole effects row. Load a preset rich in pedals.
    await loadAndExpand(page, 'Clean Echoes', 1500);
    const pedalSel = (await page.locator('.pedal').count())
      ? '.pedal' : '.pedalboard';
    await shoot(page, pedalSel, 'pedal-closeup.png', 12);
    await shoot(page, '.pedalboard', 'pedalboard-row.png', 16);

    // 4) Settings panel — the Devices section with the input + channel selectors.
    await page.click('#settings-toggle');
    await sleep(500);
    await shoot(page, '.settings-section:has(#input)', 'settings-input.png', 8);

    console.log(`\nShots written to ${outDir}/`);
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
}

run().catch((e) => { console.error('SHOTS ERROR:', e); process.exit(1); });
