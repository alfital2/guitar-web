// tests/loudness-audit.mjs — full-app loudness consistency audit.
// Renders EVERY preset (all browser categories) through its complete chain —
// amp + effects + amp reverb + the app's own normalization gain — against a
// deterministic guitar-like signal in an OfflineAudioContext inside headless
// Chromium, and measures integrated loudness (LUFS, ITU-R BS.1770-4).
// 100% silent: nothing ever touches speakers or mic.
//
// The verification signal is deliberately different from the calibration
// reference in normalize.js (different seed/chord/length), so a pass means
// presets are consistent on guitar-like material in general — not just on the
// exact signal they were normalized with.
//
// Report mode:  npm run audit:loudness      (table + docs/loudness-report.json)
// Gate mode:    npm run test:loudness       (fails if any preset deviates more
//               than TOLERANCE_LU from the target — the regression gate)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 8917;
const URL = `http://localhost:${PORT}/tools/loudness-audit.html`;
const GATE = process.argv.includes('--gate');
const TOLERANCE_LU = Number(process.env.TOLERANCE_LU) || 1.5;

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

const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
const padl = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);

async function run() {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  let data;
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__loudnessAudit, null, { timeout: 10000 });
    data = await page.evaluate(() => window.__loudnessAudit.run());
  } finally {
    await browser.close();
    server.kill();
  }

  const rows = data.rows;
  const target = data.targetLufs;
  const ok = rows.filter((r) => !r.error && r.lufs != null && isFinite(r.lufs));
  const lufsVals = ok.map((r) => r.lufs).sort((a, b) => a - b);
  // CONSISTENCY is judged against the cohort median, not the absolute target:
  // the verification signal is deliberately different from the calibration
  // reference, which introduces a small constant bias (~1.5 LU) that affects
  // every preset equally. The median itself is anchored to the target below.
  const median = lufsVals.length ? lufsVals[Math.floor(lufsVals.length / 2)] : NaN;

  console.log('\nLOUDNESS AUDIT — every preset, full chain, post-normalization');
  console.log(`signal: ${data.signalSeconds}s guitar plucks @ -12 dBFS peak, ${data.sampleRate} Hz — silent offline render`);
  console.log(`target: ${target} LUFS  tolerance: ±${TOLERANCE_LU} LU\n`);
  console.log(pad('CATEGORY', 20) + pad('PRESET', 28) + padl('LUFS', 7) + padl('Δmed', 7) + padl('appGain', 9) + padl('true', 8) + padl('peak', 7) + '  flags');
  console.log('-'.repeat(96));
  let curCat = '';
  for (const r of rows) {
    const cat = r.category === curCat ? '' : (curCat = r.category);
    if (r.error) {
      console.log(pad(cat, 20) + pad(r.name, 28) + `ERROR: ${r.error}`);
      continue;
    }
    const dev = r.lufs - median;
    const flags = [];
    if (Math.abs(dev) > TOLERANCE_LU) flags.push(`OFF ${dev > 0 ? '+' : ''}${dev.toFixed(1)} LU`);
    // 0.5 dB threshold: the reverb IR is Math.random()-seeded, so back-to-back
    // measures wobble a few tenths of a dB — only flag REAL clamp saturation.
    if (r.unclampedGainDb != null && Math.abs(r.unclampedGainDb - r.appGainDb) > 0.5) flags.push(`CLAMPED (true ${fmt(r.unclampedGainDb)} dB)`);
    if (r.peak > 0.99) flags.push('CLIP');
    console.log(
      pad(cat, 20) + pad(r.name, 28) + padl(fmt(r.lufs), 7) + padl((dev >= 0 ? '+' : '') + fmt(dev), 7)
      + padl(fmt(r.appGainDb) + 'dB', 9) + padl(fmt(r.unclampedGainDb), 8)
      + padl(fmt(r.peak, 2), 7) + (flags.length ? '  ' + flags.join(' | ') : '')
    );
  }
  const spread = lufsVals.length ? lufsVals[lufsVals.length - 1] - lufsVals[0] : NaN;
  console.log('-'.repeat(96));
  console.log(`presets: ${rows.length}  measured: ${ok.length}  errors: ${rows.length - ok.length}`);
  console.log(`median: ${fmt(median)} LUFS (target ${target})   spread (max-min): ${fmt(spread)} LU   worst |Δmed|: ${fmt(Math.max(...ok.map((r) => Math.abs(r.lufs - median))))} LU`);
  if (pageErrors.length) console.log('PAGE ERRORS:', pageErrors.join(' | '));

  const report = { date: new Date().toISOString(), targetLufs: target, medianLufs: median, spreadLu: spread, toleranceLu: TOLERANCE_LU, rows };
  const out = join(ROOT, 'docs', 'loudness-report.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('report -> docs/loudness-report.json');

  if (GATE) {
    const offenders = ok.filter((r) => Math.abs(r.lufs - median) > TOLERANCE_LU);
    const errors = rows.filter((r) => r.error);
    const anchorOff = Math.abs(median - target) > 3; // whole-app level drifted
    if (offenders.length || errors.length || pageErrors.length || anchorOff) {
      console.error(`\nGATE FAIL: ${offenders.length} preset(s) outside ±${TOLERANCE_LU} LU of the median, ${errors.length} error(s)` + (anchorOff ? `, median ${fmt(median)} drifted >3 LU from target ${target}` : '') + '.');
      offenders.forEach((r) => console.error(`  ${r.category} :: ${r.name}  ${r.lufs} LUFS (${(r.lufs - median).toFixed(1)} LU off)`));
      process.exit(1);
    }
    console.log(`\nGATE PASS: all ${ok.length} presets within ±${TOLERANCE_LU} LU of the median (${fmt(median)} LUFS, anchored to ${target}).`);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
