// tools/typography-shots.mjs — capture pedal close-ups to verify the typography
// redesign: name legibility, per-effect font/vibe match, crisp knob labels, no
// color-melt. Modeled on tools/ui-shots.mjs (same server + fake-audio launch).
//
// Usage:  node tools/typography-shots.mjs            → writes shots/typography/*.png
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SHOTS_PORT) || 8914;
const URL = `http://localhost:${PORT}/?e2e=1`;
const OUT = join(ROOT, process.argv[2] || 'shots/typography');

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

// [type, exact nameplate label]
const CASES = [
  ['compressor', 'Compressor'],
  ['delay', 'Delay'],
  ['fuzz', 'Fuzz'],
  ['distortion', 'Distortion'],
  ['tremolo', 'Tremolo'],
  ['springverb', 'Spring Reverb'],
  ['wah', 'Wah'],
  ['harmonizer', 'Harmonizer'],
  // Narrow / long-name pedals — verify fit (not clipped) beyond the core eight.
  ['pitchshift', 'Pitch Shift'],
  ['ringmod', 'Ring Mod'],
  ['autowah', 'Auto-Wah'],
  ['octave', 'Octave Fuzz'],
  ['acousticsim', 'Acoustic Sim'],
  ['phaser', 'Phaser'],
];

async function shootPedal(page, label, file, pad = 10) {
  const rx = new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  const pedal = page.locator('.pedal')
    .filter({ has: page.locator('.pedal-word', { hasText: rx }) }).first();
  await pedal.waitFor({ state: 'visible', timeout: 8000 });
  await pedal.scrollIntoViewIfNeeded();
  await sleep(120);
  const box = await pedal.boundingBox();
  const path = join(OUT, file);
  await page.screenshot({
    path,
    clip: {
      x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
      width: box.width + pad * 2, height: box.height + pad * 2,
    },
  });
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
    viewport: { width: 1440, height: 1200 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    await sleep(600);

    for (const [type] of CASES) {
      await page.evaluate((t) => window.__neuralE2E.addPedalBefore(t), type);
      await sleep(200);
    }
    // Make sure the personality fonts have actually loaded before we shoot.
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await sleep(1200);

    let ok = 0;
    for (const [, label] of CASES) if (await shootPedal(page, label, `${label.toLowerCase().replace(/[^a-z]+/g, '-')}.png`)) ok++;
    console.log(`\n${ok}/${CASES.length} shots written to ${OUT}/`);
  } finally {
    await context.close();
    await browser.close();
    server.kill();
  }
}

run().catch((e) => { console.error('TYPOGRAPHY SHOTS ERROR:', e); process.exit(1); });
