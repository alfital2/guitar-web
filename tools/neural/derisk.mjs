// tools/neural/derisk.mjs
// DE-RISK PROOF (headless Chromium). Proves §3a: the plain-wasm NAM engine,
// instantiated INSIDE an AudioWorkletGlobalScope on a NORMAL AudioContext
// (no COOP/COEP, single-thread), streams FINITE + SUSTAINED NON-SILENT output
// from a DI file. If this passes, the shippable neural-amp-processor.js is viable.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8791;
const URL = `http://localhost:${PORT}/`;
const MODEL = '/assets/neural/jcm.nam';
const DI = '/tools/neural/di-clean.wav';
const DURATION_S = Number(process.env.DURATION_S) || 4;
const MIN_WET_RMS = 0.002;                 // ~20x the ~1e-4 noise floor (matches POC)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn('node', [join(HERE, 'serve.mjs')],
  { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.on('data', (d) => d.toString().includes('serving at') && r()));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message || e)));
page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

let pass = false, minRms = Infinity, finite = true;
try {
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.derisk, null, { timeout: 15000 });

  const loaded = await page.evaluate(async ({ m, d }) => {
    try { await window.derisk.start(m, d); return { ok: window.derisk.ready() }; }
    catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }, { m: MODEL, d: DI });
  if (!loaded.ok) throw new Error('model did not load: ' + (loaded.error || 'nam_load returned 0'));

  const polls = 8;
  for (let i = 0; i < polls; i++) {
    await sleep((DURATION_S * 1000) / polls);
    const r = await page.evaluate(() => window.derisk.getOutputRMS());
    minRms = Math.min(minRms, r.rms);
    finite = finite && r.finite;
  }
  pass = finite && minRms >= MIN_WET_RMS && errors.length === 0;
  console.log(`finite=${finite}  minWetRMS=${minRms.toFixed(5)} (>= ${MIN_WET_RMS})  pageErrors=${errors.length}`);
  if (errors.length) console.log('PAGE ERRORS:', errors);
} catch (e) {
  console.error('DERISK ERROR:', e.message);
} finally {
  await browser.close();
  server.kill();
}

console.log(pass
  ? '✅ DE-RISK PASS — NAM wasm runs in a normal AudioWorklet, finite & non-silent.'
  : '❌ DE-RISK FAIL — see above.');
process.exit(pass ? 0 : 1);
