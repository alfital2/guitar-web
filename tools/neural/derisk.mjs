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
let negPass = false;
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

  // --- NEGATIVE-PATH PROOF ---------------------------------------------------
  // Proves the Critical fix: nam.cpp's nam_load try/catch is only load-bearing
  // if build.sh actually compiles with exception support (-fwasm-exceptions).
  // Without it, nlohmann::json::parse on malformed JSON calls abort() and kills
  // the WHOLE wasm instance — every AudioWorkletProcessor sharing that module
  // dies, not just the one bad load. Post a malformed model on the SAME live
  // node used above and assert (a) it reports failure gracefully — ok:false,
  // no new page error, no hang — and (b) the module is still alive: a
  // subsequent VALID model reload on that same instance loads and produces
  // finite, sustained, non-silent output again.
  const errorsBeforeNeg = errors.length;
  const badResult = await page.evaluate(() => window.derisk.loadModel('{ not json'));
  const badOk = badResult.ok === false;
  const noNewPageErrors = errors.length === errorsBeforeNeg;
  console.log(`negative-path: malformed load ok=${badResult.ok} (expect false)  newPageErrors=${errors.length - errorsBeforeNeg} (expect 0)`);

  const validJson = await page.evaluate(async (m) => (await fetch(m)).text(), MODEL);
  const reloadResult = await page.evaluate((json) => window.derisk.loadModel(json), validJson);
  const reloadOk = reloadResult.ok === true;
  console.log(`negative-path: reload after bad load ok=${reloadResult.ok} expectedSr=${reloadResult.expectedSr} (expect true)`);

  let minRmsAfter = Infinity, finiteAfter = true;
  for (let i = 0; i < polls; i++) {
    await sleep((DURATION_S * 1000) / polls);
    const r = await page.evaluate(() => window.derisk.getOutputRMS());
    minRmsAfter = Math.min(minRmsAfter, r.rms);
    finiteAfter = finiteAfter && r.finite;
  }
  const survivedAndWorks = finiteAfter && minRmsAfter >= MIN_WET_RMS;
  console.log(`negative-path: post-recovery finite=${finiteAfter}  minWetRMS=${minRmsAfter.toFixed(5)} (>= ${MIN_WET_RMS})`);

  negPass = badOk && noNewPageErrors && reloadOk && survivedAndWorks;
  console.log(negPass
    ? '✅ NEGATIVE-PATH PASS — malformed model failed gracefully; module survived and reloaded a valid model.'
    : '❌ NEGATIVE-PATH FAIL — see above.');
} catch (e) {
  console.error('DERISK ERROR:', e.message);
} finally {
  await browser.close();
  server.kill();
}

pass = pass && negPass;
console.log(pass
  ? '✅ DE-RISK PASS — NAM wasm runs in a normal AudioWorklet, finite & non-silent.'
  : '❌ DE-RISK FAIL — see above.');
process.exit(pass ? 0 : 1);
