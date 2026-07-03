// tools/amp-history-shots.mjs — clipped .amp-head screenshot for the
// "physical history" (screws / wear / dust / tolex wrap) before-after pass.
//
// Usage:  node tools/amp-history-shots.mjs shots/before
//         node tools/amp-history-shots.mjs shots/after
//
// Targets the already-running dev server at http://localhost:8000. Forces the
// amp expanded via the gs-amp-collapsed localStorage key (chain-store.js) and
// emulates reduced motion so both shots land on identical animation phases.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, process.argv[2] || 'shots/before');
const URL = process.env.SHOTS_URL || 'http://localhost:8000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1500, height: 950 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce', // freeze glint/tube pulse phases for a fair diff
});
// Expand the amp head before the app boots (default is collapsed-to-strip).
await context.addInitScript(() => localStorage.setItem('gs-amp-collapsed', '0'));
const page = await context.newPage();

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await sleep(800);
  // The powered-off state dims + desaturates the amp strip (index.html
  // body.powered-off rule); lift it so wear detail is judged at full brightness.
  await page.evaluate(() => document.body.classList.remove('powered-off'));
  await sleep(200);

  let head = page.locator('.amp-head');
  if (!(await head.count()) || !(await head.first().isVisible())) {
    // Amp still folded (e.g. persisted state raced the init script) — expand it.
    const strip = page.locator('.amp-vstrip');
    if (await strip.count()) { await strip.click(); await sleep(400); }
    head = page.locator('.amp-head');
  }
  await head.first().waitFor({ state: 'visible', timeout: 8000 });
  await head.first().scrollIntoViewIfNeeded();
  await sleep(200);

  mkdirSync(OUT, { recursive: true });
  const box = await head.first().boundingBox();
  const pad = 24; // include the handle, which overhangs the head's top edge
  const path = join(OUT, 'amp-history.png');
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.width + pad * 2, height: box.height + pad * 2,
    },
  });
  const ok = existsSync(path) && statSync(path).size > 1000;
  console.log(`  ${ok ? 'OK  ' : 'THIN'} ${path} (${statSync(path).size} bytes)`);
} finally {
  await context.close();
  await browser.close();
}
