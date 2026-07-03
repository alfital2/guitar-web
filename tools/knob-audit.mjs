// tools/knob-audit.mjs — KNOB-TRUTH audit runner.
// Drives tools/knob-audit.html in headless Chromium: every analytic-amp knob
// (drive/eq/cabinet + amp reverb stage) is rendered at min/default/max over
// the deterministic guitar reference and compared by integrated-LUFS delta and
// mean log-spectral distance, against a measured self-noise floor (identical
// render pair). Optionally sweeps every pedal param the same way.
//
//   node tools/knob-audit.mjs               amp knobs + brief pedal sweep
//   node tools/knob-audit.mjs --amp-only    amp knobs only (fast)
//   VERBOSE=1 …                             relay all page console output
//
// Prints a console table plus a ready-to-paste markdown block for
// docs/knob-audit-report.md. Report-only: exit 0 unless the harness errors.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const AMP_ONLY = process.argv.includes('--amp-only');
const FALLBACK_PORT = Number(process.env.PORT) || 8921;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serverUp(port) {
  try { const r = await fetch(`http://localhost:${port}/index.html`); return r.status < 500; } catch { return false; }
}

// Reuse the dev server on :8000 when it's already running; otherwise spawn a
// disposable python http.server like the other audit harnesses do.
async function ensureServer() {
  if (await serverUp(8000)) return { port: 8000, proc: null };
  const proc = spawn('python3', ['-m', 'http.server', String(FALLBACK_PORT)], {
    cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await serverUp(FALLBACK_PORT)) return { port: FALLBACK_PORT, proc };
    await sleep(150);
  }
  proc.kill();
  throw new Error('no dev server on :8000 and fallback server did not come up');
}

const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };
const padl = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const fmt = (v, d = 3) => (v == null || !isFinite(v)) ? '—' : v.toFixed(d);

async function run() {
  const { port, proc } = await ensureServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  page.on('console', (m) => {
    const t = m.text();
    if (process.env.VERBOSE || t.startsWith('[knob]')) console.log('  ' + t);
  });

  let data;
  try {
    await page.goto(`http://localhost:${port}/tools/knob-audit.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__knobAudit, null, { timeout: 10000 });
    data = await page.evaluate((opts) => window.__knobAudit.run(opts), { pedals: !AMP_ONLY });
  } finally {
    await browser.close();
    proc?.kill();
  }

  // ── Self-noise floor ──────────────────────────────────────────────────────
  console.log('\nKNOB-TRUTH AUDIT — analytic amp (drive → eq → cabinet + amp reverb stage)');
  console.log(`signal: ${data.refSeconds}s guitar reference (normalize.js) @ ${data.sampleRate} Hz — silent offline renders`);
  console.log(`spectral metric: mean |ΔdB| over ${data.slices.length} Hann slices (${data.nfft}-pt FFT, bins ${data.band[0]}–${data.band[1]} ≈ 47 Hz–12 kHz); "shape" = level-removed\n`);
  console.log('SELF-NOISE FLOOR (identical config rendered twice):');
  for (const [k, c] of Object.entries(data.contexts)) {
    console.log(`  ${pad(k, 10)} ${pad(c.label, 24)} floor LUFS Δ ${fmt(c.floor.lufsD, 6)}  spec Δ ${fmt(c.floor.spec, 6)} dB  (default render: ${fmt(c.defLufs, 2)} LUFS, peak ${fmt(c.defPeak, 3)})`);
  }

  // ── Amp table ─────────────────────────────────────────────────────────────
  console.log('\n' + pad('KNOB', 20) + pad('CONTEXT', 22) + padl('LUFS lo/def/hi', 22) + padl('ΔLUFS', 9) + padl('specΔ', 9) + padl('shapeΔ', 9) + padl('floor', 9) + '  verdict');
  console.log('-'.repeat(110));
  for (const r of data.rows) {
    const lufsStr = `${fmt(r.lufs.lo, 1)}${r.silent.lo ? '(sil)' : ''}/${fmt(r.lufs.def, 1)}/${fmt(r.lufs.hi, 1)}${r.silent.hi ? '(sil)' : ''}`;
    console.log(
      pad(`${r.fx}.${r.key}`, 20) + pad(r.ctxLabel, 22) + padl(lufsStr, 22)
      + padl(fmt(r.minMax.lufsD, 2), 9) + padl(fmt(r.minMax.spec, 2), 9) + padl(fmt(r.minMax.shape, 2), 9)
      + padl(fmt(data.contexts[r.context].floor.spec, 4), 9) + '  ' + r.verdict
    );
  }
  console.log('-'.repeat(110));
  console.log('ROLLUP (a knob is as alive as its liveliest context):');
  for (const k of data.rollup) console.log(`  ${pad(k.knob, 22)} ${pad(k.verdict, 7)} (best: ${k.bestContext})`);

  // ── Markdown block for docs/knob-audit-report.md ──────────────────────────
  console.log('\n===== MARKDOWN (amp) =====');
  console.log('| Knob | Context | LUFS lo/def/hi | LUFS Δ (dB) | Spectral Δ (dB) | Shape Δ (dB) | Floor (LUFS Δ / spec Δ) | Verdict |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of data.rows) {
    const f = data.contexts[r.context].floor;
    const lufsStr = `${fmt(r.lufs.lo, 1)}${r.silent.lo ? ' (silent)' : ''} / ${fmt(r.lufs.def, 1)} / ${fmt(r.lufs.hi, 1)}${r.silent.hi ? ' (silent)' : ''}`;
    console.log(`| ${r.fx}.${r.key} | ${r.ctxLabel} | ${lufsStr} | ${fmt(r.minMax.lufsD, 2)} | ${fmt(r.minMax.spec, 2)} | ${fmt(r.minMax.shape, 2)} | ${fmt(f.lufsD, 4)} / ${fmt(f.spec, 4)} | **${r.verdict}** |`);
  }

  // ── Pedals (brief) ────────────────────────────────────────────────────────
  if (data.pedals) {
    const rowsP = data.pedals.filter((p) => p.param);
    const flagged = rowsP.filter((p) => p.verdict !== 'ALIVE');
    const skipped = data.pedals.filter((p) => p.skipped);
    const errors = data.pedals.filter((p) => p.error);
    console.log(`\nPEDAL SWEEP: ${rowsP.length} params across ${new Set(rowsP.map((p) => p.type)).size} pedals — ${flagged.length} flagged (non-ALIVE), ${errors.length} errors, ${skipped.length} skipped`);
    for (const s of skipped) console.log(`  SKIP ${pad(s.type, 14)} ${s.skipped}`);
    for (const e of errors) console.log(`  ERR  ${pad(e.type + (e.param ? '.' + e.param : ''), 22)} ${e.error}`);
    console.log('\n' + pad('PEDAL PARAM', 26) + padl('ΔLUFS', 9) + padl('specΔ', 9) + padl('shapeΔ', 9) + padl('floor', 9) + '  verdict');
    console.log('-'.repeat(80));
    for (const p of rowsP) {
      console.log(pad(`${p.type}.${p.param}`, 26) + padl(fmt(p.minMax.lufsD, 2), 9) + padl(fmt(p.minMax.spec, 2), 9)
        + padl(fmt(p.minMax.shape, 2), 9) + padl(fmt(p.floor.spec, 4), 9) + '  ' + p.verdict);
    }
    console.log('\n===== MARKDOWN (pedals, flagged only) =====');
    console.log('| Pedal param | sweep (min→max) | LUFS Δ (dB) | Spectral Δ (dB) | Shape Δ (dB) | Floor (spec) | Verdict |');
    console.log('|---|---|---|---|---|---|---|');
    for (const p of flagged) {
      console.log(`| ${p.type}.${p.param} | ${p.sweep.min}→${p.sweep.max} | ${fmt(p.minMax.lufsD, 2)} | ${fmt(p.minMax.spec, 2)} | ${fmt(p.minMax.shape, 2)} | ${fmt(p.floor.spec, 4)} | **${p.verdict}** |`);
    }
  }

  if (pageErrors.length) {
    console.error('\nPAGE ERRORS:\n - ' + pageErrors.join('\n - '));
    process.exit(1);
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
