// tests/effects-probe.mjs — OBJECTIVE audio-verification harness. Renders every
// registered effect (src/effects/index.js) in a real headless-Chromium
// OfflineAudioContext (48kHz), against a repeating guitar-ish tone-burst signal
// with silent gaps and a sustained tone, and asserts:
//   1. the wet signal is not a no-op (except pure-dynamics effects at default,
//      which use their family signature instead), and
//   2. a family-specific signature is CORRECT (echo tail + onset timing for
//      delay-family, envelope modulation rate for tremolo/autopan, spectral
//      shift for chorus-family, harmonic growth for drive-family, gate
//      open/close behavior, crest-factor reduction for compressor/limiter).
//
// All signal-building and analysis runs IN the browser (tools/effect-probe.html)
// so only small per-effect metric objects cross the CDP bridge — see that file
// for the actual DSP/analysis code.
//
// Run: npm run test:probe   (or: node tests/effects-probe.mjs ; VERBOSE=1 for page logs)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.PORT) || 8913;
const URL = `http://localhost:${PORT}/tools/effect-probe.html`;

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

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

async function run() {
  const server = await startServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => { if (process.env.VERBOSE) console.log('  [page]', m.text()); });

  let results;
  try {
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__effectProbe, null, { timeout: 8000 });
    results = await page.evaluate(() => window.__effectProbe.run());
  } finally {
    await browser.close();
    server.kill();
  }

  // ---- print table ----
  console.log('\n' + pad('EFFECT', 14) + pad('VERDICT', 10) + 'METRICS');
  console.log('-'.repeat(100));
  let failCount = 0, skipCount = 0;
  const reportLines = [];
  reportLines.push('# Effects probe report\n');
  reportLines.push(`Generated ${new Date().toISOString()}\n`);
  reportLines.push('| Effect | Verdict | Checks |');
  reportLines.push('|---|---|---|');

  for (const r of results) {
    if (r.skipped) {
      skipCount++;
      console.log(pad(r.type, 14) + pad('SKIP', 10) + r.reason);
      reportLines.push(`| ${r.type} | SKIP | ${r.reason} |`);
      continue;
    }
    const verdict = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) failCount++;
    console.log(pad(r.type, 14) + pad(verdict, 10) + (r.checks[0] ? r.checks[0].detail : ''));
    for (const c of r.checks) {
      const mark = c.pass ? 'ok' : (c.informational ? 'note' : 'FAIL');
      console.log('  ' + pad('', 22) + pad(mark, 6) + c.name + '  —  ' + c.detail);
    }
    const checkLines = r.checks.map((c) => `${c.pass ? 'PASS' : (c.informational ? 'INFO' : 'FAIL')} ${c.name} (${c.detail})`).join('<br>');
    reportLines.push(`| ${r.type} | ${verdict} | ${checkLines} |`);
  }

  console.log('-'.repeat(100));
  console.log(`${results.length} effects: ${results.length - failCount - skipCount} PASS, ${failCount} FAIL, ${skipCount} SKIP`);
  if (pageErrors.length) console.log('PAGE ERRORS:\n - ' + pageErrors.join('\n - '));

  reportLines.push(`\n**Summary:** ${results.length - failCount - skipCount} PASS / ${failCount} FAIL / ${skipCount} SKIP (of ${results.length} registered effects)\n`);
  if (process.env.PROBE_REPORT) {
    writeFileSync(process.env.PROBE_REPORT, reportLines.join('\n'));
  }

  const ok = failCount === 0 && pageErrors.length === 0;
  process.exit(ok ? 0 : 1);
}

run().catch((e) => { console.error('PROBE ERROR:', e); process.exit(2); });
