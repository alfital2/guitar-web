// End-to-end functional test for the "05 Professional" neural amp, run in a real
// headless Chromium against the app served by its own dev server (python http.server,
// == `npm run dev`). Modeled on poc/nam-web/bench/benchmark.mjs.
//
// What this PROVES:
//   1. A Professional preset loads via the normal loadPreset path and the neural
//      worklet produces FINITE, SUSTAINED, NON-SILENT output on the app's own ctx
//      (min RMS over the whole window, not a single snapshot).
//   2. The graph runs in REALTIME (ctx clock advances ~1:1 with wall clock).
//   3. Inserting a pedal BEFORE the amp, and (separately) AFTER the amp, audibly
//      changes the output — beyond the measurement's own repeatability noise
//      (proves in-chain FX placement around the locked amp head works).
//   4. Switching between all 5 Professional amps yields non-silent output, and the
//      five amps produce DISTINCT output (not uniform dry passthrough) with ZERO
//      uncaught page errors.
//   5. The input-channel (1/2) selector switches without errors and audio survives.
//
// Run:  npm run test:e2e     (or: node tests/neural-e2e.mjs ; VERBOSE=1 for page logs)
//
// Notes on robustness (why this differs slightly from a naive RMS-snapshot test):
//   • getOutputMetrics reads an AnalyserNode; the FIRST read right after the tap is
//     connected returns an empty (all-zero) buffer before any render quantum has
//     flowed through it. waitForSignal() below warms the tap and waits for the model
//     to come up, so the sustained-min window never sees that startup artifact.
//   • The "output changed" gate is derived from measured self-noise (two back-to-back
//     measures of the SAME chain) rather than a magic constant — an FX must move the
//     output by more than the metric's own repeatability.
//   • The AFTER pedal is a tremolo, not a delay: a ~320 ms delay comb-filters a
//     continuous tone at ~3 Hz spacing, far finer than this analyser's ~23 Hz bins,
//     so it is invisible to both RMS (phase-averaged) and the spectrum. Tremolo's
//     amplitude modulation is a resolvable, honest, frequency-independent change.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 8901;
const URL = `http://localhost:${PORT}/?e2e=1`;

// Gates.
const MIN_RMS = 0.003;        // sustained non-silence — ~30x the ~1e-4 noise floor
const RT_LO = 0.9, RT_HI = 1.1;
const CHANGE_FLOOR = 0.03;    // absolute floor for "output changed"; actual gate is
                              // max(CHANGE_FLOOR, 4 * self-noise), computed at runtime
const HF_RATIO_MIN = 1.5;     // max/min of the 5 amps' HF-energy ratio — proves
                              // distinct models by SPECTRAL shape (loudness is
                              // normalized post-fix, so RMS can't discriminate)
const GAIN_RATIO_MIN = 2.0;   // max/min of the 5 amps' settled normGain — proves
                              // per-amp loudness normalization actually lands
                              // (the 2026-07 bug: one stale gain stuck across
                              // every preset switch). True per-amp gains span
                              // >20x; a stuck gain gives exactly 1x.
const TREM_MIN_OVER_AVG = 0.8;// deep tremolo must pull min-RMS well under avg
                              // within the window (amplitude modulation is
                              // invariant to the static normalization gain)
const WARMUP_FIRST_MS = 3000; // first .nam + cold wasm compile/build
const WARMUP_SWITCH_MS = 1500;// subsequent .nam loads (wasm module cached)
const WINDOW_MS = 4000;       // sustained-output measurement window
const SIGNAL_TIMEOUT_MS = 15000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dist = (a, b) => Math.abs(a.rms - b.rms) / Math.max(b.rms, 1e-6) + Math.abs(a.hf - b.hf);

// Loudness normalization runs as a debounced async offline render (or a
// synchronous cache hit) after a preset/chain change. "Value looks stable" is
// racy — it can report the PREVIOUS preset's gain while a 1–3 s neural measure
// is still in flight — so wait for the apply COUNTER to advance past a
// baseline captured BEFORE the change, then let the ~50 ms ramp finish.
const normCount = (page) => page.evaluate(() => window.__neuralE2E.normApplyCount());
async function waitForNormApply(page, c0, capMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < capMs) {
    if ((await normCount(page)) > c0) { await sleep(450); return page.evaluate(() => window.__neuralE2E.normGainValue()); }
    await sleep(150);
  }
  return page.evaluate(() => window.__neuralE2E.normGainValue());
}

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

// Poll the output tap until the graph is producing sound (rms >= MIN_RMS). Also
// warms the AnalyserNode so the first real read isn't an empty-buffer zero.
// Returns true once signal is present, false on timeout.
async function waitForSignal(page, timeoutMs = SIGNAL_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const m = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
    if (m.finite && m.rms >= MIN_RMS) return true;
    await sleep(150);
  }
  return false;
}

async function measure(page, ms) {
  const polls = Math.max(4, Math.round(ms / 300));
  let min = Infinity, sumR = 0, sumH = 0, finite = true, n = 0;
  for (let i = 0; i < polls; i++) {
    await sleep(ms / polls);
    const m = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
    min = Math.min(min, m.rms); sumR += m.rms; sumH += m.hf; finite = finite && m.finite; n++;
  }
  return { min, rms: sumR / n, hf: sumH / n, finite };
}

async function run() {
  const server = await startServer();
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  const fails = [];
  const check = (cond, msg) => { if (cond) { console.log('  PASS ' + msg); } else { fails.push(msg); console.log('  FAIL ' + msg); } };

  try {
    await page.goto(URL, { waitUntil: 'load' });

    // 0) Power on (a real user gesture) → the ?e2e bridge installs at end of start().
    await page.click('#power');
    await page.waitForFunction(() => window.__neuralE2E && window.__neuralE2E.booted(), null, { timeout: 15000 });
    console.log('booted @ ' + (await page.evaluate(() => window.__neuralE2E.sampleRate())) + ' Hz');

    const pros = await page.evaluate(() => window.__neuralE2E.proPresetNames());
    console.log('Professional amps:', pros.join(', '));
    check(pros.length === 5, `05 Professional has 5 amps (got ${pros.length})`);

    // 1) First amp: finite, sustained non-silent, realtime.
    await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), pros[0]);
    await page.evaluate(() => window.__neuralE2E.feedTone(110, 0.25));
    await sleep(WARMUP_FIRST_MS);
    const cameUp = await waitForSignal(page); // warms the tap + waits for the model to come up
    check(cameUp, `neural amp came up within ${SIGNAL_TIMEOUT_MS} ms`);
    const chain = await page.evaluate(() => window.__neuralE2E.chainTypes());
    check(chain.includes('neuralamp'), `preset "${pros[0]}" put neuralamp in the chain (${chain.join('>')})`);

    const clk0 = await page.evaluate(() => window.__neuralE2E.clock());
    const base = await measure(page, WINDOW_MS);
    const clk1 = await page.evaluate(() => window.__neuralE2E.clock());
    const rt = (clk1.ctxTime - clk0.ctxTime) / ((clk1.wall - clk0.wall) / 1000);
    console.log(`  ${pros[0]}: minRMS ${base.min.toFixed(5)} avgRMS ${base.rms.toFixed(5)} hf ${base.hf.toFixed(3)} rt ${rt.toFixed(3)}x`);
    check(base.finite, 'neural output is finite (no NaN/Inf)');
    check(base.min >= MIN_RMS, `neural output sustained non-silent (minRMS ${base.min.toFixed(5)} >= ${MIN_RMS})`);
    check(rt >= RT_LO && rt <= RT_HI, `graph runs in realtime (ratio ${rt.toFixed(3)})`);

    // Self-noise: repeatability of the metric across two equal, back-to-back,
    // fully-settled windows on the SAME unchanged chain sets the bar an FX must
    // clear to count as "changed output". No magic constant. Measured on settled
    // windows (not the warmup-tainted `base`) so it reflects pure repeatability.
    const b1 = await measure(page, 1500);
    const b2 = await measure(page, 1500);
    const selfNoise = dist(b2, b1);
    const CHANGE = Math.max(CHANGE_FLOOR, 4 * selfNoise);
    console.log(`  settled baseline rms ${b2.rms.toFixed(5)} self-noise ${selfNoise.toFixed(4)} → change gate ${CHANGE.toFixed(4)}`);

    // 2) Pedal BEFORE the amp changes the output (vs the settled baseline b2).
    // Adding a pedal triggers re-normalization (static gain), which compensates
    // level changes — so accept EITHER rms/hf distance OR a clear shift in
    // spectral shape (hf ratio), which the static normGain cannot cause.
    const cFuzz = await normCount(page);
    await page.evaluate(() => window.__neuralE2E.addPedalBefore('fuzz'));
    await sleep(800);
    await waitForNormApply(page, cFuzz);
    const withBefore = await measure(page, 1500);
    const dBefore = dist(withBefore, b2);
    const hfShift = Math.max(withBefore.hf, b2.hf) / Math.max(Math.min(withBefore.hf, b2.hf), 1e-6);
    const chainBefore = await page.evaluate(() => window.__neuralE2E.chainTypes());
    console.log(`  +fuzz BEFORE: rms ${withBefore.rms.toFixed(5)} hf ${withBefore.hf.toFixed(3)} dist ${dBefore.toFixed(3)} hfShift ${hfShift.toFixed(2)}x chain ${chainBefore.join('>')}`);
    check(chainBefore[0] === 'fuzz' && chainBefore.includes('neuralamp'), `fuzz sits BEFORE the amp (${chainBefore.join('>')})`);
    check(withBefore.finite && (dBefore > CHANGE || hfShift > 1.3),
      `pedal BEFORE amp changes output (dist ${dBefore.toFixed(3)} > ${CHANGE.toFixed(3)} or hf shift ${hfShift.toFixed(2)}x > 1.3x)`);

    // Reset to a clean Professional chain, then a pedal AFTER the amp changes output.
    // Loudness normalization compensates static level changes, so the honest
    // post-amp evidence is MODULATION: deep tremolo drags the window's min-RMS
    // far below its average — a ratio the static normGain cannot touch.
    const cReset = await normCount(page);
    await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), pros[0]);
    await sleep(WARMUP_SWITCH_MS);
    await waitForSignal(page);
    await waitForNormApply(page, cReset);
    const base2 = await measure(page, 1500);
    const baseTremRatio = base2.min / Math.max(base2.rms, 1e-9);
    await page.evaluate(() => window.__neuralE2E.addPedalAfter('tremolo'));
    await page.evaluate(() => window.__neuralE2E.setPedalParam('tremolo', 'depth', 1));
    await page.evaluate(() => window.__neuralE2E.setPedalParam('tremolo', 'rate', 7));
    await sleep(800);
    // Sample FAST relative to the 7 Hz (~143 ms) modulation: 130 ms polls drift
    // ~13 ms of phase per poll, sweeping the whole cycle over ~11 polls — the
    // default 300 ms cadence aliases against the period and can sample only
    // near-peak phases, missing the troughs entirely.
    const withAfter = await (async () => {
      let min = Infinity, sum = 0, finite = true;
      for (let i = 0; i < 14; i++) {
        await sleep(130);
        const m = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
        min = Math.min(min, m.rms); sum += m.rms; finite = finite && m.finite;
      }
      return { min, rms: sum / 14, finite };
    })();
    const tremRatio = withAfter.min / Math.max(withAfter.rms, 1e-9);
    const chainAfter = await page.evaluate(() => window.__neuralE2E.chainTypes());
    console.log(`  +tremolo AFTER: rms ${withAfter.rms.toFixed(5)} min/avg ${tremRatio.toFixed(3)} (baseline ${baseTremRatio.toFixed(3)}) chain ${chainAfter.join('>')}`);
    check(chainAfter[chainAfter.indexOf('neuralamp') + 1] === 'tremolo', `tremolo sits AFTER the amp (${chainAfter.join('>')})`);
    check(withAfter.finite && tremRatio < TREM_MIN_OVER_AVG && tremRatio < baseTremRatio - 0.1,
      `pedal AFTER amp modulates output (min/avg ${tremRatio.toFixed(3)} < ${TREM_MIN_OVER_AVG} and well under baseline ${baseTremRatio.toFixed(3)})`);

    // 3) Switch through all 5 amps: each non-silent, finite, no page errors.
    // The tap reads POST loudness-normalization (normGain). Distinctness is
    // proven by spectral shape (hf ratio) — normalization can't touch it — and
    // by the per-amp normGain values themselves: five captures with different
    // inherent levels MUST settle five different gains (the 2026-07 bug was one
    // stale gain stuck across every switch, gain ratio exactly 1x).
    const switchHf = [], switchGains = [];
    for (const name of pros) {
      const cSwitch = await normCount(page);
      await page.evaluate((n) => window.__neuralE2E.loadPresetByName(n), name);
      await sleep(WARMUP_SWITCH_MS);
      await waitForSignal(page);
      const settledGain = await waitForNormApply(page, cSwitch); // measure (or cache hit) lands the gain
      const m = await measure(page, 1500);
      switchHf.push(m.hf); switchGains.push(settledGain);
      console.log(`  switch → ${name}: minRMS ${m.min.toFixed(5)} avgRMS ${m.rms.toFixed(5)} hf ${m.hf.toFixed(3)} normGain ${settledGain == null ? 'null' : settledGain.toFixed(3)} finite ${m.finite}`);
      check(m.finite && m.min >= MIN_RMS, `amp "${name}" produces finite sustained output`);
    }
    // Distinct models, not uniform dry passthrough: spectral shape must differ.
    const hfRatio = Math.max(...switchHf) / Math.max(Math.min(...switchHf), 1e-6);
    console.log(`  amp HF-shape ratio ${hfRatio.toFixed(2)}x`);
    check(hfRatio > HF_RATIO_MIN, `5 amps process distinctly, not uniform passthrough (hf ratio ${hfRatio.toFixed(2)}x > ${HF_RATIO_MIN}x)`);
    // Loudness normalization is ALIVE per amp (the volume-inconsistency fix):
    const gains = switchGains.filter((g) => g != null && isFinite(g));
    const gainRatio = gains.length === 5 ? Math.max(...gains) / Math.max(Math.min(...gains), 1e-6) : 0;
    console.log(`  per-amp normGain ratio ${gainRatio.toFixed(2)}x (gains: ${gains.map((g) => g.toFixed(2)).join(', ')})`);
    check(gainRatio > GAIN_RATIO_MIN, `per-amp loudness normalization lands (gain ratio ${gainRatio.toFixed(2)}x > ${GAIN_RATIO_MIN}x)`);

    // 4) Input-channel (1/2) selector: switch ch2 then ch1, audio survives, no errors.
    const chanCount = await page.locator('#input-channel').count();
    check(chanCount === 1, 'input-channel selector present (#input-channel)');
    if (chanCount === 1) {
      const optCount = await page.locator('#input-channel option').count();
      check(optCount >= 2, `input-channel offers 1/2 (got ${optCount} options)`);
      await page.selectOption('#input-channel', { index: 1 });
      await sleep(600);
      const ch2 = await page.evaluate(() => window.__neuralE2E.getOutputMetrics());
      check(ch2.finite, 'audio finite after selecting channel 2');
      await page.selectOption('#input-channel', { index: 0 });
      await sleep(600);
      const ch1 = await measure(page, 1500);
      check(ch1.finite && ch1.min >= MIN_RMS, `audio survives return to channel 1 (minRMS ${ch1.min.toFixed(5)})`);
    }

    await page.evaluate(() => window.__neuralE2E.stopTone());
    check(pageErrors.length === 0, `no uncaught page errors (got ${pageErrors.length})`);
    if (pageErrors.length) console.log('  PAGE ERRORS:\n   - ' + pageErrors.join('\n   - '));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n' + '='.repeat(64));
  const ok = fails.length === 0;
  console.log(ok
    ? '✅ NEURAL E2E PASS — Professional amps load, stream live, respond to pedals, switch cleanly, channel selector works.'
    : `❌ NEURAL E2E FAIL — ${fails.length} check(s):\n - ` + fails.join('\n - '));
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error('E2E ERROR:', e); process.exit(2); });
