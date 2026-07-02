// Compose BEFORE/AFTER screenshot pairs into single labeled side-by-side PNGs.
// Usage: node tools/ui-compare.mjs   (reads shots/before + shots/after -> shots/compare)
import { readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BEFORE = join(ROOT, 'shots/before');
const AFTER = join(ROOT, 'shots/after');
const OUT = join(ROOT, 'shots/compare');

const page_html = (name, beforeUrl, afterUrl) => `<!doctype html><html><head><style>
  body { margin: 0; background: #101216; font: 700 13px -apple-system, sans-serif; }
  .wrap { display: flex; gap: 14px; padding: 16px; align-items: flex-start; width: fit-content; }
  figure { margin: 0; }
  figcaption { color: #8b93a3; letter-spacing: .12em; margin-bottom: 8px; }
  figcaption.after { color: #f0b429; }
  img { display: block; max-width: 880px; height: auto; border-radius: 8px; border: 1px solid #2a2f3a; }
  h1 { color: #e7e9ee; font-size: 14px; margin: 14px 0 0 16px; letter-spacing: .06em; }
</style></head><body>
  <h1>${name}</h1>
  <div class="wrap">
    <figure><figcaption>BEFORE</figcaption><img src="${beforeUrl}"></figure>
    <figure><figcaption class="after">AFTER</figcaption><img src="${afterUrl}"></figure>
  </div>
</body></html>`;

await mkdir(OUT, { recursive: true });
const names = (await readdir(BEFORE)).filter((f) => f.endsWith('.png'));
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const tmp = join(OUT, '_compare.html');
await page.setViewportSize({ width: 1860, height: 1400 });
for (const f of names) {
  // Written to disk + loaded via file:// so the file:// <img> subresources are
  // same-origin (setContent's about:blank page blocks them).
  const html = page_html(f.replace('.png', ''), pathToFileURL(join(BEFORE, f)).href, pathToFileURL(join(AFTER, f)).href);
  await writeFile(tmp, html);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  const box = await page.locator('.wrap').boundingBox();
  await page.screenshot({ path: join(OUT, f), clip: { x: 0, y: 0, width: Math.min(1860, box.x + box.width + 16), height: Math.min(1400, box.y + box.height + 16) } });
  console.log('  OK  ', f);
}
await rm(tmp, { force: true });
await browser.close();
console.log('Composites written to shots/compare/');
